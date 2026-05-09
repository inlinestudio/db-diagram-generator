import type { ConnectionConfig, DiagramPayload, TableSchema } from '@shared/schema';
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

export class DemoAdapter implements DbAdapter {
  async connect(_cfg: ConnectionConfig) {}
  async disconnect() {}

  async getDiagram(): Promise<DiagramPayload> {
    return { tables: [users, orders, sessions] };
  }
}
