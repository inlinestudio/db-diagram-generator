import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import pkg from 'electron-updater';
import { IPC } from '@shared/ipc';
import type { ConnectionConfig } from '@shared/schema';
import { active, connect, disconnect } from './db';
import * as connections from './connections';

const { autoUpdater } = pkg;
const isDev = !app.isPackaged;

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Version ${info.version} is available.`,
      detail: 'Download and install the update?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'Update downloaded.',
      detail: 'Restart now to install, or it will install when you next quit.',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    console.error('autoUpdater error:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('checkForUpdates failed:', err));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    icon: process.platform === 'win32'
      ? join(__dirname, '../../build/icon.ico')
      : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock && isDev) {
    app.dock.setIcon(join(__dirname, '../../build/icon.png'));
  }

  ipcMain.handle(IPC.connect, async (_e, cfg: ConnectionConfig) => {
    try {
      await connect(cfg);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.disconnect, async () => {
    await disconnect();
  });

  ipcMain.handle(IPC.getDiagram, async () => {
    return active().getDiagram();
  });

  ipcMain.handle(IPC.listSaved, async () => connections.list());

  ipcMain.handle(IPC.saveConnection, async (_e, name: string, cfg: ConnectionConfig) => {
    try {
      const id = await connections.save(name, cfg);
      return { ok: true as const, id };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.deleteConnection, async (_e, id: string) => connections.remove(id));

  ipcMain.handle(IPC.loadSaved, async (_e, id: string) => connections.loadConfig(id));

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
