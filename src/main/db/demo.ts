import type { ConnectionConfig, DiagramPayload, TableRef, TableSchema } from '@shared/schema';
import type { DbAdapter } from './types';

const users: TableSchema = {
  schema: 'public',
  name: 'users',
  columns: [
    { name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true, default: null, comment: null },
    { name: 'email', dataType: 'varchar(255)', nullable: false, isPrimaryKey: false, default: null, comment: null },
    { name: 'name', dataType: 'varchar(120)', nullable: true, isPrimaryKey: false, default: null, comment: null },
    { name: 'created_at', dataType: 'timestamptz', nullable: false, isPrimaryKey: false, default: 'now()', comment: null }
  ],
  foreignKeys: [],
  referencedBy: [
    { columns: ['id'], refSchema: 'public', refTable: 'orders', refColumns: ['user_id'] },
    { columns: ['id'], refSchema: 'public', refTable: 'sessions', refColumns: ['user_id'] }
  ]
};

const orders: TableSchema = {
  schema: 'public',
  name: 'orders',
  columns: [
    { name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true, default: null, comment: null },
    { name: 'user_id', dataType: 'bigint', nullable: false, isPrimaryKey: false, default: null, comment: null },
    { name: 'total', dataType: 'numeric(10,2)', nullable: false, isPrimaryKey: false, default: '0', comment: null },
    { name: 'status', dataType: 'varchar(32)', nullable: false, isPrimaryKey: false, default: "'pending'", comment: null }
  ],
  foreignKeys: [
    { columns: ['user_id'], refSchema: 'public', refTable: 'users', refColumns: ['id'], onDelete: 'CASCADE' }
  ],
  referencedBy: []
};

const sessions: TableSchema = {
  schema: 'public',
  name: 'sessions',
  columns: [
    { name: 'token', dataType: 'varchar(64)', nullable: false, isPrimaryKey: true, default: null, comment: null },
    { name: 'user_id', dataType: 'bigint', nullable: false, isPrimaryKey: false, default: null, comment: null },
    { name: 'expires_at', dataType: 'timestamptz', nullable: false, isPrimaryKey: false, default: null, comment: null }
  ],
  foreignKeys: [
    { columns: ['user_id'], refSchema: 'public', refTable: 'users', refColumns: ['id'], onDelete: 'CASCADE' }
  ],
  referencedBy: []
};

const TABLES: Record<string, TableSchema> = {
  'public.users': users,
  'public.orders': orders,
  'public.sessions': sessions
};

export class DemoAdapter implements DbAdapter {
  async connect(_cfg: ConnectionConfig) {}
  async disconnect() {}

  async listTables(): Promise<TableRef[]> {
    return Object.values(TABLES).map((t) => ({ schema: t.schema, name: t.name }));
  }

  async getDiagram(table: TableRef): Promise<DiagramPayload> {
    const key = `${table.schema ?? 'public'}.${table.name}`;
    const root = TABLES[key];
    if (!root) throw new Error(`Unknown table: ${key}`);

    const neighborKeys = new Set<string>();
    for (const fk of root.foreignKeys) neighborKeys.add(`${fk.refSchema ?? 'public'}.${fk.refTable}`);
    for (const ref of root.referencedBy) neighborKeys.add(`${ref.refSchema ?? 'public'}.${ref.refTable}`);

    const neighbors = [...neighborKeys].map((k) => TABLES[k]).filter((t): t is TableSchema => Boolean(t));
    return { root, neighbors };
  }
}
