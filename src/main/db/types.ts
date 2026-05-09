import type { ConnectionConfig, DiagramPayload } from '@shared/schema';

export interface DbAdapter {
  connect(cfg: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  getDiagram(): Promise<DiagramPayload>;
}
