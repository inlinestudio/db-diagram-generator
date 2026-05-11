import type { ConnectionConfig, DiagramPayload } from '@shared/schema';
import type { DbAdapter } from './types';

export class MssqlAdapter implements DbAdapter {
    async connect(_cfg: ConnectionConfig): Promise<void> {
        throw new Error('MSSQL adapter: not yet implemented.');
    }
    async disconnect(): Promise<void> { }
    async getDiagram(): Promise<DiagramPayload> {
        throw new Error('MSSQL adapter: not yet implemented.');
    }
}
