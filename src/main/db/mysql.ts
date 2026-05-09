import type { ConnectionConfig, DiagramPayload } from '@shared/schema';
import type { DbAdapter } from './types';

export class MysqlAdapter implements DbAdapter {
  async connect(_cfg: ConnectionConfig): Promise<void> {
    throw new Error('MySQL adapter: not yet implemented. See CLAUDE.md "When extending".');
  }
  async disconnect(): Promise<void> {}
  async getDiagram(): Promise<DiagramPayload> {
    throw new Error('MySQL adapter: not yet implemented.');
  }
}
