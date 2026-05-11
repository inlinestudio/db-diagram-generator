import { Client } from 'pg';
import type { ConnectionConfig, DiagramPayload, TableSchema, ColumnMeta, ForeignKey } from '@shared/schema';
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

  private async loadTable(schema: string, name: string): Promise<TableSchema> {
    const cols = await this.c().query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
      udt_name: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default, udt_name,
              character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, name]
    );

    const pks = await this.c().query<{ column_name: string }>(
      `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2`,
      [schema, name]
    );
    const pkSet = new Set(pks.rows.map((r) => r.column_name));

    const uqs = await this.c().query<{ constraint_oid: number; column_name: string }>(
      `SELECT con.oid AS constraint_oid, a.attname AS column_name
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
        WHERE con.contype = 'u' AND n.nspname = $1 AND c.relname = $2
        ORDER BY con.oid, u.ord`,
      [schema, name]
    );
    const uqMap = new Map<number, string[]>();
    for (const r of uqs.rows) {
      if (!uqMap.has(r.constraint_oid)) uqMap.set(r.constraint_oid, []);
      uqMap.get(r.constraint_oid)!.push(r.column_name);
    }
    const uniqueConstraints = [...uqMap.values()];
    const uqSet = new Set(uniqueConstraints.flat());

    const columns: ColumnMeta[] = cols.rows.map((r) => ({
      name: r.column_name,
      dataType: formatPgType(r),
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: pkSet.has(r.column_name),
      isUnique: uqSet.has(r.column_name),
      default: r.column_default,
      comment: null
    }));

    const fkRows = await this.c().query<{
      conname: string;
      cols: string[];
      ref_schema: string;
      ref_table: string;
      ref_cols: string[];
      on_delete: string;
      on_update: string;
    }>(
      `SELECT con.conname,
              array_agg(att.attname::text ORDER BY u.ord) AS cols,
              rn.nspname AS ref_schema,
              rc.relname AS ref_table,
              array_agg(ratt.attname::text ORDER BY u.ord) AS ref_cols,
              con.confdeltype::text AS on_delete,
              con.confupdtype::text AS on_update
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
         JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(conkey, confkey, ord) ON true
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.conkey
         JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = u.confkey
        WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2
        GROUP BY con.conname, rn.nspname, rc.relname, con.confdeltype, con.confupdtype`,
      [schema, name]
    );

    const foreignKeys: ForeignKey[] = fkRows.rows.map((r) => ({
      columns: r.cols,
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumns: r.ref_cols,
      onDelete: pgFkAction(r.on_delete),
      onUpdate: pgFkAction(r.on_update)
    }));

    const refRows = await this.c().query<{
      cols: string[];
      ref_schema: string;
      ref_table: string;
      ref_cols: string[];
    }>(
      `SELECT array_agg(att.attname::text ORDER BY u.ord) AS cols,
              n.nspname AS ref_schema,
              c.relname AS ref_table,
              array_agg(ratt.attname::text ORDER BY u.ord) AS ref_cols
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
         JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(conkey, confkey, ord) ON true
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.conkey
         JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = u.confkey
        WHERE con.contype = 'f' AND rn.nspname = $1 AND rc.relname = $2
        GROUP BY con.conname, n.nspname, c.relname`,
      [schema, name]
    );

    const referencedBy: ForeignKey[] = refRows.rows.map((r) => ({
      columns: r.cols,
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumns: r.ref_cols
    }));

    return { schema, name, columns, foreignKeys, referencedBy, uniqueConstraints };
  }

  async getDiagram(): Promise<DiagramPayload> {
    const refs = await this.listTables();
    const tables = await Promise.all(refs.map((r) => this.loadTable(r.schema, r.name)));
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
