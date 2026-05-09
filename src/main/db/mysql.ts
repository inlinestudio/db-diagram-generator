import type { ConnectionConfig, DiagramPayload, TableRef } from '@shared/schema';
import type { DbAdapter } from './types';

export class MysqlAdapter implements DbAdapter {
  async connect(_cfg: ConnectionConfig): Promise<void> {
    throw new Error('MySQL adapter: not yet implemented. See CLAUDE.md "When extending".');
  }
  async disconnect(): Promise<void> {}
  async listTables(): Promise<TableRef[]> {
    throw new Error('MySQL adapter: not yet implemented.');
  }
  async getDiagram(_table: TableRef): Promise<DiagramPayload> {
    throw new Error('MySQL adapter: not yet implemented.');
  }
}
