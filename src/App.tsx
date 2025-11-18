import { useState } from 'react';
import { ConnectionPage } from './components/ConnectionPage';
import { MapView } from './components/MapView';
import { RosbridgeConnection } from './utils/RosbridgeConnection';
import './App.css';

function App() {
  const [connection, setConnection] = useState<RosbridgeConnection | null>(null);
  const [connected, setConnected] = useState(false);

  const handleConnect = async (url: string): Promise<boolean> => {
    const conn = new RosbridgeConnection();
    const success = await conn.connect(url);
    if (success) {
      setConnection(conn);
      setConnected(true);
      return true;
    }
    return false;
  };

  const handleDisconnect = () => {
    if (connection) {
      connection.disconnect();
      setConnection(null);
      setConnected(false);
    }
  };

  if (connected && connection) {
    return (
      <div>
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
          <button onClick={handleDisconnect} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
            断开连接
          </button>
        </div>
        <MapView connection={connection} />
      </div>
    );
  }

  return <ConnectionPage onConnect={handleConnect} />;
}

export default App;
