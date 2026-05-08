import type { ConnectionConfig, DiagramPayload, TableRef } from '@shared/schema';

export interface DbAdapter {
  connect(cfg: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  listTables(): Promise<TableRef[]>;
  getDiagram(table: TableRef): Promise<DiagramPayload>;
}
