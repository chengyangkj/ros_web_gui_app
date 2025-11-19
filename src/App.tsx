import { useCallback, useEffect, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ConnectionPage } from './components/ConnectionPage';
import { MapView } from './components/MapView';
import { RosbridgeConnection } from './utils/RosbridgeConnection';
import './App.css';

function App() {
  const [connection, setConnection] = useState<RosbridgeConnection | null>(null);
  const [connected, setConnected] = useState(false);

  const updateUrl = (wsUrl: string) => {
    const path = `/${encodeURIComponent(wsUrl)}`;
    window.history.pushState({ wsUrl }, '', path);
  };

  const getWsUrlFromUrl = (): string | null => {
    const path = window.location.pathname;
    if (path && path.length > 1) {
      try {
        const decoded = decodeURIComponent(path.substring(1));
        if (decoded.startsWith('ws://') || decoded.startsWith('wss://')) {
          return decoded;
        }
      } catch (e) {
        console.error('Failed to decode URL:', e);
      }
    }
    return null;
  };

  const handleConnect = useCallback(async (url: string): Promise<boolean> => {
    const conn = new RosbridgeConnection();
    const success = await conn.connect(url);
    if (success) {
      setConnection(conn);
      setConnected(true);
      updateUrl(url);
      return true;
    }
    return false;
  }, []);

  const handleDisconnect = () => {
    if (connection) {
      connection.disconnect();
      setConnection(null);
      setConnected(false);
      window.history.pushState({}, '', '/');
    }
  };

  useEffect(() => {
    const wsUrl = getWsUrlFromUrl();
    if (wsUrl && !connected) {
      void handleConnect(wsUrl);
    }

    const handlePopState = () => {
      const wsUrl = getWsUrlFromUrl();
      if (wsUrl) {
        if (!connected) {
          void handleConnect(wsUrl);
        }
      } else {
        if (connected && connection) {
          connection.disconnect();
          setConnection(null);
          setConnected(false);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [connected, handleConnect, connection]);

  if (connected && connection) {
    return (
      <>
        <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
          <MapView connection={connection} />
        </div>
        <ToastContainer position="top-center" />
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
