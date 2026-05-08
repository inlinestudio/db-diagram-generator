import { useState } from 'react';
import type { DiagramPayload, TableRef } from '@shared/schema';
import ConnectionForm from './components/ConnectionForm';
import TablePicker from './components/TablePicker';
import Diagram from './components/Diagram';

type Stage = 'connect' | 'pick' | 'diagram';

export default function App() {
  const [stage, setStage] = useState<Stage>('connect');
  const [tables, setTables] = useState<TableRef[]>([]);
  const [diagram, setDiagram] = useState<DiagramPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnected = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await window.db.listTables();
      setTables(t);
      setStage('pick');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (table: TableRef) => {
    setBusy(true);
    setError(null);
    try {
      const d = await window.db.getDiagram(table);
      setDiagram(d);
      setStage('diagram');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    await window.db.disconnect();
    setTables([]);
    setDiagram(null);
    setStage('connect');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>DB Diagram Generator</h1>
        {stage !== 'connect' && (
          <button onClick={handleDisconnect} className="btn-link">Disconnect</button>
        )}
      </header>
      {error && <div className="error">{error}</div>}
      {stage === 'connect' && <ConnectionForm onConnected={handleConnected} busy={busy} />}
      {stage === 'pick' && <TablePicker tables={tables} onPick={handlePick} busy={busy} />}
      {stage === 'diagram' && diagram && (
        <Diagram payload={diagram} onBack={() => setStage('pick')} />
      )}
    </div>
  );
}
