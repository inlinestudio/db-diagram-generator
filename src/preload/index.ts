import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type { ConnectionConfig } from '@shared/schema';

const api = {
  connect: (cfg: ConnectionConfig) => ipcRenderer.invoke(IPC.connect, cfg),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  getDiagram: () => ipcRenderer.invoke(IPC.getDiagram),
  listSaved: () => ipcRenderer.invoke(IPC.listSaved),
  saveConnection: (name: string, cfg: ConnectionConfig) =>
    ipcRenderer.invoke(IPC.saveConnection, name, cfg),
  deleteConnection: (id: string) => ipcRenderer.invoke(IPC.deleteConnection, id),
  loadSaved: (id: string) => ipcRenderer.invoke(IPC.loadSaved, id)
};

contextBridge.exposeInMainWorld('db', api);
