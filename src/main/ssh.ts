import { Client } from 'ssh2';
import { createServer, type Socket } from 'node:net';
import log from 'electron-log/main';
import type { SshConfig } from '@shared/schema';

export type Tunnel = {
  localPort: number;
  close: () => Promise<void>;
};

export type DestConfig = {
  host: string;
  port: number;
};

export function openTunnel(ssh: SshConfig, dest: DestConfig): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      log.error('SSH tunnel error', err);
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    client.on('error', fail);

    client.on('ready', () => {
      const server = createServer((socket: Socket) => {
        client.forwardOut(
          socket.remoteAddress ?? '127.0.0.1',
          socket.remotePort ?? 0,
          dest.host,
          dest.port,
          (err, stream) => {
            if (err) {
              log.error('SSH forwardOut failed', err);
              socket.destroy();
              return;
            }
            socket.pipe(stream).pipe(socket);
            stream.on('error', () => socket.destroy());
            socket.on('error', () => stream.destroy());
          }
        );
      });

      server.on('error', fail);

      server.listen(0, '127.0.0.1', () => {
        if (settled) return;
        const addr = server.address();
        const localPort = typeof addr === 'object' && addr ? addr.port : 0;
        if (!localPort) {
          fail(new Error('Failed to allocate local tunnel port'));
          return;
        }
        settled = true;
        resolve({
          localPort,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => {
                try {
                  client.end();
                } catch {
                  /* ignore */
                }
                res();
              });
            })
        });
      });
    });

    client.connect({
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      password: ssh.password,
      keepaliveInterval: 30_000,
      readyTimeout: 15_000
    });
  });
}