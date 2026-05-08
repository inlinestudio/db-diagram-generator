import type { IpcContract } from '@shared/ipc';

declare global {
  interface Window {
    db: IpcContract;
  }
}

export {};
