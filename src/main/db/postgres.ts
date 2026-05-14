import { Client } from 'pg';
import type { ConnectionConfig, DiagramPayload, TableSchema, ColumnMeta, ForeignKey, IndexMeta } from '@shared/schema';
import type { DbAdapter } from './types';

type TableRef = { schema: string; name: string };

export class PostgresAdapter implements DbAdapter {
    private client: Client | null = null;

    async connect(cfg: ConnectionConfig) {
        if (cfg.dialect !== 'postgres') throw new Error('Wrong dialect for PostgresAdapter');
        this.client = new Client({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            ssl: cfg.ssl ? { rejectUnauthorized: true } : undefined
        });
        await this.client.connect();
    }

    async disconnect() {
        await this.client?.end();
        this.client = null;
    }

    private c() {
        if (!this.client) throw new Error('Not connected');
        return this.client;
    }

    private async listTables(): Promise<TableRef[]> {
        const res = await this.c().query<{ schema: string; name: string }>(
            `SELECT table_schema AS schema, table_name AS name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY schema, name`
        );
        return res.rows;
    }

    private async loadAllTables(refs: TableRef[]): Promise<TableSchema[]> {
        const EXCL = `('pg_catalog','information_schema')`;

        const colRes = await this.c().query<{
            table_schema: string; table_name: string;
            column_name: string; data_type: string;
            is_nullable: 'YES' | 'NO'; column_default: string | null;
            udt_name: string; character_maximum_length: number | null;
            numeric_precision: number | null; numeric_scale: number | null;
        }>(`SELECT table_schema, table_name, column_name, data_type, is_nullable,
                   column_default, udt_name, character_maximum_length, numeric_precision, numeric_scale
              FROM information_schema.columns
             WHERE table_schema NOT IN ${EXCL}
             ORDER BY table_schema, table_name, ordinal_position`);

        const pkRes = await this.c().query<{ schema: string; table_name: string; column_name: string }>(
            `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name
               FROM pg_index i
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
               JOIN pg_class c ON c.oid = i.indrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE i.indisprimary AND n.nspname NOT IN ${EXCL}`);

        const uqRes = await this.c().query<{ schema: string; table_name: string; constraint_oid: number; column_name: string }>(
            `SELECT n.nspname AS schema, c.relname AS table_name, con.oid AS constraint_oid, a.attname AS column_name
               FROM pg_constraint con
               JOIN pg_class c ON c.oid = con.conrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
              WHERE con.contype = 'u' AND n.nspname NOT IN ${EXCL}
              ORDER BY n.nspname, c.relname, con.oid, u.ord`);

        const fkRes = await this.c().query<{
            schema: string; table_name: string; conname: string;
            cols: string[]; ref_schema: string; ref_table: string; ref_cols: string[];
            on_delete: string; on_update: string;
        }>(`SELECT n.nspname AS schema, c.relname AS table_name, con.conname,
                   array_agg(att.attname::text ORDER BY u.ord) AS cols,
                   rn.nspname AS ref_schema, rc.relname AS ref_table,
                   array_agg(ratt.attname::text ORDER BY u.ord) AS ref_cols,
                   con.confdeltype::text AS on_delete, con.confupdtype::text AS on_update
              FROM pg_constraint con
              JOIN pg_class c ON c.oid = con.conrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_class rc ON rc.oid = con.confrelid
              JOIN pg_namespace rn ON rn.oid = rc.relnamespace
              JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(conkey, confkey, ord) ON true
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.conkey
              JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = u.confkey
             WHERE con.contype = 'f' AND n.nspname NOT IN ${EXCL}
             GROUP BY n.nspname, c.relname, con.conname, rn.nspname, rc.relname, con.confdeltype, con.confupdtype`);

        const idxRes = await this.c().query<{ schema: string; table_name: string; index_name: string; column_name: string; index_type: string }>(
            `SELECT n.nspname AS schema, c.relname AS table_name, i.relname AS index_name,
                    a.attname::text AS column_name, upper(am.amname) AS index_type
               FROM pg_index x
               JOIN pg_class c  ON c.oid = x.indrelid
               JOIN pg_class i  ON i.oid = x.indexrelid
               JOIN pg_am am    ON am.oid = i.relam
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS ix(col, ord) ON true
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ix.col
              WHERE n.nspname NOT IN ${EXCL}
                AND x.indisprimary = false
                AND x.indisunique  = false
                AND ix.col != 0
              ORDER BY n.nspname, c.relname, i.relname, ix.ord`);

        const refByRes = await this.c().query<{
            tgt_schema: string; tgt_table: string;
            cols: string[]; ref_schema: string; ref_table: string; ref_cols: string[];
        }>(`SELECT rn.nspname AS tgt_schema, rc.relname AS tgt_table,
                   array_agg(att.attname::text ORDER BY u.ord) AS cols,
                   n.nspname AS ref_schema, c.relname AS ref_table,
                   array_agg(ratt.attname::text ORDER BY u.ord) AS ref_cols
              FROM pg_constraint con
              JOIN pg_class c ON c.oid = con.conrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_class rc ON rc.oid = con.confrelid
              JOIN pg_namespace rn ON rn.oid = rc.relnamespace
              JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(conkey, confkey, ord) ON true
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.conkey
              JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = u.confkey
             WHERE con.contype = 'f' AND rn.nspname NOT IN ${EXCL}
             GROUP BY con.conname, rn.nspname, rc.relname, n.nspname, c.relname`);

        const colsByTable = new Map<string, typeof colRes.rows>();
        for (const r of colRes.rows) {
            const k = `${r.table_schema}.${r.table_name}`;
            if (!colsByTable.has(k)) colsByTable.set(k, []);
            colsByTable.get(k)!.push(r);
        }

        const pksByTable = new Map<string, Set<string>>();
        for (const r of pkRes.rows) {
            const k = `${r.schema}.${r.table_name}`;
            if (!pksByTable.has(k)) pksByTable.set(k, new Set());
            pksByTable.get(k)!.add(r.column_name);
        }

        const uqsByTable = new Map<string, Map<number, string[]>>();
        for (const r of uqRes.rows) {
            const k = `${r.schema}.${r.table_name}`;
            if (!uqsByTable.has(k)) uqsByTable.set(k, new Map());
            const m = uqsByTable.get(k)!;
            if (!m.has(r.constraint_oid)) m.set(r.constraint_oid, []);
            m.get(r.constraint_oid)!.push(r.column_name);
        }

        const fksByTable = new Map<string, ForeignKey[]>();
        for (const r of fkRes.rows) {
            const k = `${r.schema}.${r.table_name}`;
            if (!fksByTable.has(k)) fksByTable.set(k, []);
            fksByTable.get(k)!.push({
                columns: r.cols,
                refSchema: r.ref_schema,
                refTable: r.ref_table,
                refColumns: r.ref_cols,
                onDelete: pgFkAction(r.on_delete),
                onUpdate: pgFkAction(r.on_update)
            });
        }

        const idxsByTable = new Map<string, Map<string, { columns: string[]; type: string }>>();
        for (const r of idxRes.rows) {
            const k = `${r.schema}.${r.table_name}`;
            if (!idxsByTable.has(k)) idxsByTable.set(k, new Map());
            const m = idxsByTable.get(k)!;
            if (!m.has(r.index_name)) m.set(r.index_name, { columns: [], type: r.index_type });
            m.get(r.index_name)!.columns.push(r.column_name);
        }

        const refBysByTable = new Map<string, ForeignKey[]>();
        for (const r of refByRes.rows) {
            const k = `${r.tgt_schema}.${r.tgt_table}`;
            if (!refBysByTable.has(k)) refBysByTable.set(k, []);
            refBysByTable.get(k)!.push({
                columns: r.cols,
                refSchema: r.ref_schema,
                refTable: r.ref_table,
                refColumns: r.ref_cols
            });
        }

        return refs.map(({ schema, name }) => {
            const k = `${schema}.${name}`;
            const cols = colsByTable.get(k) ?? [];
            const pkSet = pksByTable.get(k) ?? new Set<string>();
            const uqMap = uqsByTable.get(k) ?? new Map<number, string[]>();
            const uniqueConstraints = [...uqMap.values()];
            const uqSet = new Set(uniqueConstraints.flat());

            const columns: ColumnMeta[] = cols.map((r) => ({
                name: r.column_name,
                dataType: formatPgType(r),
                nullable: r.is_nullable === 'YES',
                isPrimaryKey: pkSet.has(r.column_name),
                isUnique: uqSet.has(r.column_name),
                default: r.column_default,
                comment: null
            }));

            const idxMap = idxsByTable.get(k) ?? new Map<string, { columns: string[]; type: string }>();
            const indexes: IndexMeta[] = [...idxMap.entries()].map(([name, v]) => ({ name, columns: v.columns, type: v.type }));

            return {
                schema,
                name,
                columns,
                foreignKeys: fksByTable.get(k) ?? [],
                referencedBy: refBysByTable.get(k) ?? [],
                uniqueConstraints,
                indexes
            };
        });
    }

    async getDiagram(): Promise<DiagramPayload> {
        const refs = await this.listTables();
        const tables = await this.loadAllTables(refs);
        return { tables };
    }
}

function formatPgType(r: {
    data_type: string;
    udt_name: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
}): string {
    if (r.data_type === 'character varying' || r.data_type === 'character') {
        const base = r.data_type === 'character varying' ? 'varchar' : 'char';
        return r.character_maximum_length != null ? `${base}(${r.character_maximum_length})` : base;
    }
    if (r.data_type === 'numeric' && r.numeric_precision != null) {
        return r.numeric_scale != null
            ? `numeric(${r.numeric_precision},${r.numeric_scale})`
            : `numeric(${r.numeric_precision})`;
    }
    if (r.data_type === 'ARRAY') return `${r.udt_name.replace(/^_/, '')}[]`;
    if (r.data_type === 'USER-DEFINED') return r.udt_name;
    return r.data_type;
}

function pgFkAction(code: string): string | undefined {
    switch (code) {
        case 'a':
            return 'NO ACTION';
        case 'r':
            return 'RESTRICT';
        case 'c':
            return 'CASCADE';
        case 'n':
            return 'SET NULL';
        case 'd':
            return 'SET DEFAULT';
        default:
            return undefined;
    }
}