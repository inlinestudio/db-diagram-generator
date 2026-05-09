import type { ConnectionConfig, DiagramPayload, TableRef } from './schema';

export const IPC = {
  connect: 'db:connect',
  disconnect: 'db:disconnect',
  listTables: 'db:listTables',
  getDiagram: 'db:getDiagram',
  listSaved: 'conn:list',
  saveConnection: 'conn:save',
  deleteConnection: 'conn:delete',
  loadSaved: 'conn:load'
} as const;

export type ConnectResult = { ok: true } | { ok: false; error: string };
export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export type SavedConnectionMeta = {
  id: string;
  name: string;
  dialect: ConnectionConfig['dialect'];
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  file?: string;
  ssl?: boolean;
};

export type IpcContract = {
  connect: (cfg: ConnectionConfig) => Promise<ConnectResult>;
  disconnect: () => Promise<void>;
  listTables: () => Promise<TableRef[]>;
  getDiagram: (table: TableRef) => Promise<DiagramPayload>;
  listSaved: () => Promise<SavedConnectionMeta[]>;
  saveConnection: (name: string, cfg: ConnectionConfig) => Promise<SaveResult>;
  deleteConnection: (id: string) => Promise<void>;
  loadSaved: (id: string) => Promise<ConnectionConfig>;
};
