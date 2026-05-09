import type { ConnectionConfig } from '@shared/schema';
import { DemoAdapter } from './demo';
import { PostgresAdapter } from './postgres';
import { MysqlAdapter } from './mysql';
import { SqliteAdapter } from './sqlite';
import { MssqlAdapter } from './mssql';
import type { DbAdapter } from './types';

let current: DbAdapter | null = null;

function build(cfg: ConnectionConfig): DbAdapter {
  switch (cfg.dialect) {
    case 'demo':
      return new DemoAdapter();
    case 'postgres':
      return new PostgresAdapter();
    case 'mysql':
      return new MysqlAdapter();
    case 'sqlite':
      return new SqliteAdapter();
    case 'mssql':
      return new MssqlAdapter();
  }
}

export async function connect(cfg: ConnectionConfig) {
  if (current) {
    await current.disconnect().catch(() => {});
    current = null;
  }
  const adapter = build(cfg);
  await adapter.connect(cfg);
  current = adapter;
}

export async function disconnect() {
  if (!current) return;
  await current.disconnect().catch(() => {});
  current = null;
}

export function active(): DbAdapter {
  if (!current) throw new Error('No active connection');
  return current;
}
