import { useMemo, useState } from 'react';
import type { TableRef } from '@shared/schema';

type Props = { tables: TableRef[]; onPick: (t: TableRef) => void; busy: boolean };

export default function TablePicker({ tables, onPick, busy }: Props) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) =>
      `${t.schema ?? ''}.${t.name}`.toLowerCase().includes(q)
    );
  }, [tables, filter]);

  return (
    <div className="card">
      <h2>Pick a table</h2>
      <input
        className="search"
        placeholder="Filter tables…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="table-list">
        {filtered.map((t) => {
          const key = `${t.schema ?? ''}.${t.name}`;
          return (
            <li key={key}>
              <button disabled={busy} onClick={() => onPick(t)}>
                {t.schema ? <span className="schema">{t.schema}.</span> : null}
                <span className="name">{t.name}</span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="empty">No tables match.</li>}
      </ul>
    </div>
  );
}
