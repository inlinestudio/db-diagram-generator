import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConnectionConfig, Dialect } from '@shared/schema';

type StoredEntry = {
    id: string;
    name: string;
    config: StoredConfig;
};

type StoredSsh = {
    host: string;
    port: number;
    user: string;
    encryptedPassword: string | null;
};

type StoredConfig =
    | {
        dialect: 'postgres' | 'mysql' | 'mssql';
        host: string;
        port: number;
        user: string;
        database: string;
        ssl: boolean;
        encryptedPassword: string | null;
        ssh: StoredSsh | null;
    }
    | { dialect: 'sqlite'; file: string }
    | { dialect: 'demo' };

export type SavedConnectionMeta = {
    id: string;
    name: string;
    dialect: Dialect;
    host?: string;
    port?: number;
    user?: string;
    database?: string;
    file?: string;
    ssl?: boolean;
    ssh?: { host: string; port: number; user: string };
};

let cache: StoredEntry[] | null = null;
const filePath = () => join(app.getPath('userData'), 'connections.json');

async function load(): Promise<StoredEntry[]> {
    if (cache) return cache;
    try {
        const raw = await fs.readFile(filePath(), 'utf8');
        const parsed = JSON.parse(raw);
        cache = Array.isArray(parsed.connections) ? parsed.connections : [];
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            console.error('connections.json load failed:', err);
        }
        cache = [];
    }
    return cache!;
}

async function persist(): Promise<void> {
    await fs.writeFile(filePath(), JSON.stringify({ connections: cache ?? [] }, null, 2), 'utf8');
}

function ensureSecureBackend(): void {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-level encryption unavailable; refusing to save password.');
    }
    if (process.platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'unknown') {
            throw new Error(
                `Linux keyring not available (backend=${backend}). Install gnome-libsecret or kwallet, or unlock the keyring; refusing to save password with weak backend.`
            );
        }
    }
}

export async function list(): Promise<SavedConnectionMeta[]> {
    const all = await load();
    return all.map((e) => ({
        id: e.id,
        name: e.name,
        dialect: e.config.dialect,
        host: 'host' in e.config ? e.config.host : undefined,
        port: 'port' in e.config ? e.config.port : undefined,
        user: 'user' in e.config ? e.config.user : undefined,
        database: 'database' in e.config ? e.config.database : undefined,
        file: 'file' in e.config ? e.config.file : undefined,
        ssl: 'ssl' in e.config ? e.config.ssl : undefined,
        ssh:
            'ssh' in e.config && e.config.ssh
                ? { host: e.config.ssh.host, port: e.config.ssh.port, user: e.config.ssh.user }
                : undefined
    }));
}

export async function save(name: string, cfg: ConnectionConfig): Promise<string> {
    const all = await load();
    const id = randomUUID();
    let stored: StoredConfig;

    if (cfg.dialect === 'demo') {
        stored = { dialect: 'demo' };
    } else if (cfg.dialect === 'sqlite') {
        stored = { dialect: 'sqlite', file: cfg.file };
    } else {
        let encryptedPassword: string | null = null;
        if (cfg.password) {
            ensureSecureBackend();
            encryptedPassword = safeStorage.encryptString(cfg.password).toString('base64');
        }
        let storedSsh: StoredSsh | null = null;
        if (cfg.ssh) {
            let encSshPw: string | null = null;
            if (cfg.ssh.password) {
                ensureSecureBackend();
                encSshPw = safeStorage.encryptString(cfg.ssh.password).toString('base64');
            }
            storedSsh = {
                host: cfg.ssh.host,
                port: cfg.ssh.port,
                user: cfg.ssh.user,
                encryptedPassword: encSshPw
            };
        }
        stored = {
            dialect: cfg.dialect,
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            database: cfg.database,
            ssl: cfg.ssl ?? false,
            encryptedPassword,
            ssh: storedSsh
        };
    }

    all.push({ id, name, config: stored });
    cache = all;
    await persist();
    return id;
}

export async function remove(id: string): Promise<void> {
    const all = await load();
    cache = all.filter((e) => e.id !== id);
    await persist();
}

export async function loadConfig(id: string): Promise<ConnectionConfig> {
    const all = await load();
    const entry = all.find((e) => e.id === id);
    if (!entry) throw new Error(`Saved connection not found: ${id}`);

    const c = entry.config;
    if (c.dialect === 'demo') return { dialect: 'demo' };
    if (c.dialect === 'sqlite') return { dialect: 'sqlite', file: c.file };

    let password = '';
    if (c.encryptedPassword) {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Cannot decrypt saved password: OS encryption unavailable.');
        }
        password = safeStorage.decryptString(Buffer.from(c.encryptedPassword, 'base64'));
    }
    const ssh = c.ssh
        ? {
            host: c.ssh.host,
            port: c.ssh.port,
            user: c.ssh.user,
            password: c.ssh.encryptedPassword
                ? safeStorage.decryptString(Buffer.from(c.ssh.encryptedPassword, 'base64'))
                : ''
        }
        : undefined;
    return {
        dialect: c.dialect,
        host: c.host,
        port: c.port,
        user: c.user,
        password,
        database: c.database,
        ssl: c.ssl,
        ...(ssh ? { ssh } : {})
    };
}
