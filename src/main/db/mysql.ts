import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import type {
    ConnectionConfig,
    DiagramPayload,
    TableSchema,
    ColumnMeta,
    ForeignKey
} from '@shared/schema';
import type { DbAdapter } from './types';

type TableRef = {
    schema: string;
    name: string;
};

export class MysqlAdapter implements DbAdapter {
    private connection: Connection | null = null;

    async connect(cfg: ConnectionConfig) {
        if (cfg.dialect !== 'mysql') {
            throw new Error('Wrong dialect for MysqlAdapter');
        }

        this.connection = await mysql.createConnection({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            ssl: cfg.ssl ? {} : undefined,
            rowsAsArray: false
        });
    }

    async disconnect() {
        await this.connection?.end();
        this.connection = null;
    }

    private c() {
        if (!this.connection) {
            throw new Error('Not connected');
        }

        return this.connection;
    }

    private async listTables(): Promise<TableRef[]> {
        const [rows] = await this.c().query<RowDataPacket[]>(
            `
            SELECT
                table_schema AS schema_name,
                table_name AS table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema = DATABASE()
            ORDER BY table_name
            `
        );

        return (rows as any[]).map((r) => ({
            schema: r.schema_name,
            name: r.table_name
        }));
    }

    private async loadTable(schema: string, name: string): Promise<TableSchema> {
        const [colRows] = await this.c().query<RowDataPacket[]>(
            `
            SELECT
                column_name,
                column_type,
                data_type,
                is_nullable,
                column_default,
                column_key,
                extra,
                character_maximum_length,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_schema = ?
              AND table_name = ?
            ORDER BY ordinal_position
            `,
            [schema, name]
        );

        const [uniqueRows] = await this.c().query<RowDataPacket[]>(
            `
            SELECT
                tc.constraint_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_schema = kcu.constraint_schema
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
             AND tc.constraint_name = kcu.constraint_name
            WHERE tc.constraint_type = 'UNIQUE'
              AND tc.table_schema = ?
              AND tc.table_name = ?
            ORDER BY tc.constraint_name, kcu.ordinal_position
            `,
            [schema, name]
        );

        const uqMap = new Map<string, string[]>();

        for (const row of uniqueRows as any[]) {
            if (!uqMap.has(row.constraint_name)) {
                uqMap.set(row.constraint_name, []);
            }

            uqMap.get(row.constraint_name)!.push(row.column_name);
        }

        const uniqueConstraints = [...uqMap.values()];
        const uqSet = new Set(uniqueConstraints.flat());

        const columns: ColumnMeta[] = (colRows as any[]).map((r) => ({
            name: r.COLUMN_NAME,
            dataType: formatMysqlType({
                column_type: r.COLUMN_TYPE,
                data_type: r.DATA_TYPE,
                character_maximum_length: r.CHARACTER_MAXIMUM_LENGTH,
                numeric_precision: r.NUMERIC_PRECISION,
                numeric_scale: r.NUMERIC_SCALE
            }),
            nullable: r.IS_NULLABLE === 'YES',
            isPrimaryKey: r.COLUMN_KEY === 'PRI',
            isUnique: r.COLUMN_KEY === 'UNI' || uqSet.has(r.COLUMN_NAME),
            default: r.COLUMN_DEFAULT,
            comment: null
        }));

        const [fkRows] = await this.c().query<RowDataPacket[]>(
            `
            SELECT
                rc.constraint_name,
                kcu.column_name,
                kcu.referenced_table_schema,
                kcu.referenced_table_name,
                kcu.referenced_column_name,
                rc.delete_rule,
                rc.update_rule,
                kcu.ordinal_position
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu
              ON rc.constraint_schema = kcu.constraint_schema
             AND rc.constraint_name = kcu.constraint_name
             AND rc.table_name = kcu.table_name
            WHERE rc.constraint_schema = ?
              AND rc.table_name = ?
            ORDER BY rc.constraint_name, kcu.ordinal_position
            `,
            [schema, name]
        );

        const fkMap = new Map<
            string,
            {
                columns: string[];
                refSchema: string;
                refTable: string;
                refColumns: string[];
                onDelete?: string;
                onUpdate?: string;
            }
        >();

        for (const row of fkRows as any[]) {
            if (!fkMap.has(row.constraint_name)) {
                fkMap.set(row.constraint_name, {
                    columns: [],
                    refSchema: row.referenced_table_schema,
                    refTable: row.referenced_table_name,
                    refColumns: [],
                    onDelete: row.delete_rule,
                    onUpdate: row.update_rule
                });
            }

            const fk = fkMap.get(row.constraint_name)!;

            fk.columns.push(row.column_name);
            fk.refColumns.push(row.referenced_column_name);
        }

        const foreignKeys: ForeignKey[] = [...fkMap.values()];

        const [refRows] = await this.c().query<RowDataPacket[]>(
            `
            SELECT
                rc.constraint_name,
                kcu.column_name,
                kcu.table_schema,
                kcu.table_name,
                kcu.referenced_column_name,
                kcu.ordinal_position
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu
              ON rc.constraint_schema = kcu.constraint_schema
             AND rc.constraint_name = kcu.constraint_name
             AND rc.table_name = kcu.table_name
            WHERE kcu.referenced_table_schema = ?
              AND kcu.referenced_table_name = ?
            ORDER BY rc.constraint_name, kcu.ordinal_position
            `,
            [schema, name]
        );

        const refMap = new Map<
            string,
            {
                columns: string[];
                refSchema: string;
                refTable: string;
                refColumns: string[];
            }
        >();

        for (const row of refRows as any[]) {
            if (!refMap.has(row.constraint_name)) {
                refMap.set(row.constraint_name, {
                    columns: [],
                    refSchema: row.table_schema,
                    refTable: row.table_name,
                    refColumns: []
                });
            }

            const ref = refMap.get(row.constraint_name)!;

            ref.columns.push(row.column_name);
            ref.refColumns.push(row.referenced_column_name);
        }

        const referencedBy: ForeignKey[] = [...refMap.values()];

        return {
            schema,
            name,
            columns,
            foreignKeys,
            referencedBy,
            uniqueConstraints
        };
    }

    async getDiagram(): Promise<DiagramPayload> {
        const refs = await this.listTables();

        const tables = await Promise.all(
            refs.map((r) => this.loadTable(r.schema, r.name))
        );

        return { tables };
    }
}

function formatMysqlType(r: {
    column_type: string;
    data_type: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
}): string {
    if (
        r.data_type === 'varchar' ||
        r.data_type === 'char' ||
        r.data_type === 'binary' ||
        r.data_type === 'varbinary'
    ) {
        return r.character_maximum_length != null
            ? `${r.data_type}(${r.character_maximum_length})`
            : r.data_type;
    }

    if (
        ['decimal', 'numeric'].includes(r.data_type) &&
        r.numeric_precision != null
    ) {
        return r.numeric_scale != null
            ? `${r.data_type}(${r.numeric_precision},${r.numeric_scale})`
            : `${r.data_type}(${r.numeric_precision})`;
    }

    return r.column_type;
}