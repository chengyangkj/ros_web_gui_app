import { useState } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
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
      <>
        <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
            <button onClick={handleDisconnect} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
              断开连接
            </button>
          </div>
          <MapView connection={connection} />
        </div>
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      <ConnectionPage onConnect={handleConnect} />
      <ToastContainer />
    </>
  );
}

export default App;
