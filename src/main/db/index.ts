import type { ConnectionConfig } from '@shared/schema';
import { DemoAdapter } from './demo';
import { PostgresAdapter } from './postgres';
import { MysqlAdapter } from './mysql';
import { SqliteAdapter } from './sqlite';
import { MssqlAdapter } from './mssql';
import type { DbAdapter } from './types';
import { openTunnel, type Tunnel } from '../ssh';

let current: DbAdapter | null = null;
let currentTunnel: Tunnel | null = null;

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
  await disconnect();

  let effectiveCfg = cfg;
  let tunnel: Tunnel | null = null;

  if (cfg.dialect !== 'demo' && cfg.dialect !== 'sqlite' && cfg.ssh) {
    tunnel = await openTunnel(cfg.ssh, { host: cfg.host, port: cfg.port });
    effectiveCfg = { ...cfg, host: '127.0.0.1', port: tunnel.localPort };
    delete (effectiveCfg as { ssh?: unknown }).ssh;
  }

  try {
    const adapter = build(effectiveCfg);
    await adapter.connect(effectiveCfg);
    current = adapter;
    currentTunnel = tunnel;
  } catch (err) {
    if (tunnel) await tunnel.close().catch(() => {});
    throw err;
  }
}

export async function disconnect() {
  if (current) {
    await current.disconnect().catch(() => {});
    current = null;
  }
  if (currentTunnel) {
    await currentTunnel.close().catch(() => {});
    currentTunnel = null;
  }
}

export function active(): DbAdapter {
  if (!current) throw new Error('No active connection');
  return current;
}
