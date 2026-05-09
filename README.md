# DB Diagram Generator

Native desktop tool that connects to a database, picks a table, and renders its columns + foreign-key neighbors as an ER diagram. Read-only, with one-click PNG export. Inspired by [dbdiagram.io](https://dbdiagram.io/) and [chartdb](https://github.com/chartdb/chartdb), but without the visual editor — just point it at a live schema and look.

Built with Electron, React, TypeScript, and [React Flow](https://reactflow.dev/). Cross-platform (macOS, Windows, Linux).

## Features

- Connect to a live database, pick a table, see it diagrammed with its FK neighbors.
- Column metadata on each node: data type, length, precision, nullable, primary-key and foreign-key badges.
- Auto-layout with [dagre](https://github.com/dagrejs/dagre) (left-to-right). Drag nodes; viewport stays put.
- Snap-to-grid toggle (icon button in the bottom-left controls).
- Auto-fit node width based on widest column row (with min/max bounds).
- Export the current diagram to PNG with a single click.
- Save and recall connections — passwords encrypted via the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux).
- No telemetry, no SaaS, no account.

## Status

**Postgres works end-to-end.** Other dialects are stubbed — drivers are wired in `package.json`, but the introspection queries are not yet implemented.

| Dialect | Driver | Status |
|---|---|---|
| PostgreSQL | `pg` | ✅ Implemented |
| MySQL / MariaDB | `mysql2` | ⏳ Stub |
| MS SQL Server | `mssql` | ⏳ Stub |
| SQLite | `node:sqlite` (planned) | ⏳ Stub |

The built-in **Demo** dialect ships a small canned schema (`users`, `orders`, `sessions`) so you can try the app without touching a real database.

## Quick start

Requires **Node.js 22+** (uses built-in `node:sqlite` for the upcoming SQLite adapter).

```bash
npm install
npm run dev
```

The Electron window opens with a connection form. Pick **Demo**, click **Connect**, click any table — done. To use a real database, pick the dialect, fill in credentials, and connect.

## Build

```bash
npm run typecheck      # full TS check (main + preload + renderer)
npm run build          # bundle main / preload / renderer
```

## Package as a native app

`electron-builder` is wired for all three platforms:

```bash
npm run package        # current OS / current arch
npm run package:mac    # macOS  (.dmg + .zip)
npm run package:win    # Windows (.exe NSIS installer + .zip)
npm run package:linux  # Linux  (.AppImage + .deb)
npm run package:all    # all three
```

Output lands in `release/`.

> **macOS code signing** is not configured. The app runs fine locally on the build machine, but Gatekeeper will block it on other Macs. For distribution outside your own machine, you need an Apple Developer cert and notarization.

## Architecture

Three-layer split, enforced by where files live:

```
src/
├── main/         Electron main process. Owns DB connections + credentials.
│   ├── db/       Per-dialect adapters: postgres, mysql, sqlite, mssql, demo.
│   └── connections.ts   Saved-connection persistence via safeStorage.
├── preload/      contextBridge — exposes a typed, narrow API to the renderer.
├── renderer/     React app. Pure UI. Talks to main only via window.db.
└── shared/       IPC channel names + DB schema types used by both sides.
```

DB drivers live exclusively in the main process. The renderer never imports a driver — node-native modules don't load in the renderer sandbox, and credentials never enter the UI bundle. All introspection results cross IPC as a normalized `TableSchema` shape (defined in `src/shared/schema.ts`), so per-dialect quirks stay in main.

For diagram rendering, the renderer runs dagre in-browser to lay out the React Flow graph and uses [`html-to-image`](https://github.com/bubkoo/html-to-image) (pinned to **exactly 1.11.11** — newer versions silently drop edges from the export) for PNG snapshots.

## Saved connections

Saved connection metadata lives in `connections.json` under your OS userData directory (`~/Library/Application Support/DB Diagram Generator/` on macOS). Passwords are encrypted with [Electron's `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage). On Linux, if neither gnome-libsecret nor kwallet is available, the app refuses to save — it will not silently downgrade to weak obfuscation.

## License

See [LICENSE](LICENSE).
