import { useState } from 'react';
import './ConnectionPage.css';

interface ConnectionPageProps {
  onConnect: (url: string) => Promise<boolean>;
}

export function ConnectionPage({ onConnect }: ConnectionPageProps) {
  const [ip, setIp] = useState(() => {
    const hostname = window.location.hostname;
    return hostname || 'localhost';
  });
  const [port, setPort] = useState('9090');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!ip || !port) {
      setError('请输入IP和端口');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const url = `ws://${ip}:${port}`;
      const success = await onConnect(url);
      if (!success) {
        setError('连接失败，请检查IP和端口是否正确');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="ConnectionPage">
      <div className="ConnectionForm">
        <h1>机器人连接</h1>
        <div className="FormGroup">
          <label htmlFor="ip">IP地址:</label>
          <input
            id="ip"
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="localhost"
            disabled={connecting}
          />
        </div>
        <div className="FormGroup">
          <label htmlFor="port">端口:</label>
          <input
            id="port"
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="9090"
            disabled={connecting}
          />
        </div>
        {error && <div className="Error">{error}</div>}
        <button onClick={handleConnect} disabled={connecting}>
          {connecting ? '连接中...' : '连接'}
        </button>
      </div>
    </div>
  );
}

