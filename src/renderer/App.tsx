import { useState } from 'react';
import type { DiagramPayload } from '@shared/schema';
import ConnectionForm from './components/ConnectionForm';
import Diagram from './components/Diagram';

type Stage = 'connect' | 'diagram';

export default function App() {
  const [stage, setStage] = useState<Stage>('connect');
  const [diagram, setDiagram] = useState<DiagramPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnected = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await window.db.getDiagram();
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
      {stage === 'diagram' && diagram && <Diagram payload={diagram} />}
    </div>
  );
}
