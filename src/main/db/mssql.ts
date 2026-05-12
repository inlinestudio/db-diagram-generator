import type { ConnectionConfig, DiagramPayload, TableSchema, ColumnMeta, ForeignKey } from '@shared/schema';
import type { DbAdapter } from './types';

type TableRef = { schema: string; name: string };

const MS_ODBC_DOCS = 'https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server';

export class MssqlAdapter implements DbAdapter {
    private pool: any = null;

    async connect(cfg: ConnectionConfig) {
        if (cfg.dialect !== 'mssql') throw new Error('Wrong dialect for MssqlAdapter');

        let mssql: any;
        try {
            const mod = await import('mssql');
            mssql = mod.default ?? mod;
        } catch {
            throw new Error(
                `mssql package not found. Install the Microsoft ODBC Driver for SQL Server by following the Microsoft documentation: ${MS_ODBC_DOCS}`
            );
        }

        try {
            this.pool = await new mssql.ConnectionPool({
                user: cfg.user,
                password: cfg.password,
                server: cfg.host,
                port: cfg.port,
                database: cfg.database,
                options: {
                    encrypt: cfg.ssl ?? false,
                    trustServerCertificate: !cfg.ssl,
                    enableArithAbort: true,
                },
            }).connect();
        } catch (err: any) {
            const msg: string = err?.message ?? '';
            if (/driver|ODBC|provider/i.test(msg)) {
                throw new Error(
                    `${msg}\n\nYou may need to install the Microsoft ODBC Driver for SQL Server. Follow the Microsoft documentation: ${MS_ODBC_DOCS}`
                );
            }
            throw err;
        }
    }

    async disconnect() {
        await this.pool?.close();
        this.pool = null;
    }

    private req() {
        if (!this.pool) throw new Error('Not connected');
        return this.pool.request();
    }

    private async listTables(): Promise<TableRef[]> {
        const result = await this.req().query(
            `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
               FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_TYPE = 'BASE TABLE'
              ORDER BY TABLE_SCHEMA, TABLE_NAME`
        );
        return result.recordset as TableRef[];
    }

    private async loadAllTables(refs: TableRef[]): Promise<TableSchema[]> {
        const [colRes, pkRes, uqRes, fkRes] = await Promise.all([
            this.req().query(
                `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME,
                        c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
                        c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE,
                        c.DATETIME_PRECISION
                   FROM INFORMATION_SCHEMA.COLUMNS c
                  ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
            ),
            this.req().query(
                `SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME
                   FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                   JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                     ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                    AND tc.CONSTRAINT_NAME  = kcu.CONSTRAINT_NAME
                    AND tc.TABLE_NAME       = kcu.TABLE_NAME
                  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`
            ),
            this.req().query(
                `SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.COLUMN_NAME
                   FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                   JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                     ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                    AND tc.CONSTRAINT_NAME  = kcu.CONSTRAINT_NAME
                    AND tc.TABLE_NAME       = kcu.TABLE_NAME
                  WHERE tc.CONSTRAINT_TYPE = 'UNIQUE'
                  ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`
            ),
            this.req().query(
                `SELECT fk.name                                      AS constraint_name,
                        SCHEMA_NAME(tp.schema_id)                    AS table_schema,
                        tp.name                                      AS table_name,
                        cp.name                                      AS column_name,
                        SCHEMA_NAME(tr.schema_id)                    AS ref_schema,
                        tr.name                                      AS ref_table,
                        cr.name                                      AS ref_column,
                        fk.delete_referential_action_desc            AS on_delete,
                        fk.update_referential_action_desc            AS on_update,
                        fkc.constraint_column_id                     AS col_ord
                   FROM sys.foreign_keys            fk
                   JOIN sys.foreign_key_columns     fkc ON fk.object_id        = fkc.constraint_object_id
                   JOIN sys.tables                  tp  ON tp.object_id         = fk.parent_object_id
                   JOIN sys.columns                 cp  ON cp.object_id         = fk.parent_object_id
                                                      AND cp.column_id          = fkc.parent_column_id
                   JOIN sys.tables                  tr  ON tr.object_id         = fk.referenced_object_id
                   JOIN sys.columns                 cr  ON cr.object_id         = fk.referenced_object_id
                                                      AND cr.column_id          = fkc.referenced_column_id
                  ORDER BY fk.name, fkc.constraint_column_id`
            ),
        ]);

        const colsByTable = new Map<string, any[]>();
        for (const r of colRes.recordset as any[]) {
            const k = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`;
            if (!colsByTable.has(k)) colsByTable.set(k, []);
            colsByTable.get(k)!.push(r);
        }

        const pksByTable = new Map<string, Set<string>>();
        for (const r of pkRes.recordset as any[]) {
            const k = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`;
            if (!pksByTable.has(k)) pksByTable.set(k, new Set());
            pksByTable.get(k)!.add(r.COLUMN_NAME);
        }

        const uqsByTable = new Map<string, Map<string, string[]>>();
        for (const r of uqRes.recordset as any[]) {
            const k = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`;
            if (!uqsByTable.has(k)) uqsByTable.set(k, new Map());
            const m = uqsByTable.get(k)!;
            if (!m.has(r.CONSTRAINT_NAME)) m.set(r.CONSTRAINT_NAME, []);
            m.get(r.CONSTRAINT_NAME)!.push(r.COLUMN_NAME);
        }

        const fksByTable = new Map<string, Map<string, ForeignKey>>();
        const refsByTable = new Map<string, Map<string, ForeignKey>>();
        for (const r of fkRes.recordset as any[]) {
            const srcKey = `${r.table_schema}.${r.table_name}`;
            if (!fksByTable.has(srcKey)) fksByTable.set(srcKey, new Map());
            const fkMap = fksByTable.get(srcKey)!;
            if (!fkMap.has(r.constraint_name)) {
                fkMap.set(r.constraint_name, {
                    columns: [],
                    refSchema: r.ref_schema,
                    refTable: r.ref_table,
                    refColumns: [],
                    onDelete: normaliseAction(r.on_delete),
                    onUpdate: normaliseAction(r.on_update),
                });
            }
            const fk = fkMap.get(r.constraint_name)!;
            fk.columns.push(r.column_name);
            fk.refColumns.push(r.ref_column);

            const refKey = `${r.ref_schema}.${r.ref_table}`;
            if (!refsByTable.has(refKey)) refsByTable.set(refKey, new Map());
            const refMap = refsByTable.get(refKey)!;
            if (!refMap.has(r.constraint_name)) {
                refMap.set(r.constraint_name, {
                    columns: [],
                    refSchema: r.table_schema,
                    refTable: r.table_name,
                    refColumns: [],
                });
            }
            const ref = refMap.get(r.constraint_name)!;
            ref.columns.push(r.ref_column);
            ref.refColumns.push(r.column_name);
        }

        return refs.map(({ schema, name }) => {
            const k = `${schema}.${name}`;
            const cols = colsByTable.get(k) ?? [];
            const pkSet = pksByTable.get(k) ?? new Set<string>();
            const uqMap = uqsByTable.get(k) ?? new Map<string, string[]>();
            const uniqueConstraints = [...uqMap.values()];
            const uqSet = new Set(uniqueConstraints.flat());

            const columns: ColumnMeta[] = cols.map((r) => ({
                name: r.COLUMN_NAME,
                dataType: formatMssqlType(r),
                nullable: r.IS_NULLABLE === 'YES',
                isPrimaryKey: pkSet.has(r.COLUMN_NAME),
                isUnique: uqSet.has(r.COLUMN_NAME),
                default: r.COLUMN_DEFAULT ?? null,
                comment: null,
            }));

            return {
                schema,
                name,
                columns,
                foreignKeys: [...(fksByTable.get(k)?.values() ?? [])],
                referencedBy: [...(refsByTable.get(k)?.values() ?? [])],
                uniqueConstraints,
            };
        });
    }

    async getDiagram(): Promise<DiagramPayload> {
        const refs = await this.listTables();
        const tables = await this.loadAllTables(refs);
        return { tables };
    }
}

function formatMssqlType(r: {
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
    DATETIME_PRECISION: number | null;
}): string {
    const t = r.DATA_TYPE.toLowerCase();
    if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(t)) {
        const len = r.CHARACTER_MAXIMUM_LENGTH;
        if (len == null) return t;
        return len === -1 ? `${t}(max)` : `${t}(${len})`;
    }
    if (['decimal', 'numeric'].includes(t) && r.NUMERIC_PRECISION != null) {
        return r.NUMERIC_SCALE != null
            ? `${t}(${r.NUMERIC_PRECISION},${r.NUMERIC_SCALE})`
            : `${t}(${r.NUMERIC_PRECISION})`;
    }
    if (['datetime2', 'datetimeoffset', 'time'].includes(t) && r.DATETIME_PRECISION != null) {
        return `${t}(${r.DATETIME_PRECISION})`;
    }
    return t;
}

function normaliseAction(desc: string | null): string | undefined {
    if (!desc) return undefined;
    switch (desc.toUpperCase()) {
        case 'NO_ACTION': return 'NO ACTION';
        case 'CASCADE': return 'CASCADE';
        case 'SET_NULL': return 'SET NULL';
        case 'SET_DEFAULT': return 'SET DEFAULT';
        default: return desc;
    }
}