import type { LayerConfigMap } from '../types/LayerConfig';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';

interface ManualControlPanelProps {
  layerConfigs: LayerConfigMap;
  cmdVelTopic: string;
  connection: RosbridgeConnection;
  activeKeysRef: React.MutableRefObject<Set<string>>;
}

export function ManualControlPanel({
  layerConfigs,
  cmdVelTopic,
  connection,
  activeKeysRef,
}: ManualControlPanelProps) {
  const cmdVelConfig = Object.values(layerConfigs).find(config => config.id === 'cmd_vel');
  const linearXSpeed = (cmdVelConfig?.linearXSpeed as number | undefined) ?? 0.5;
  const linearYSpeed = (cmdVelConfig?.linearYSpeed as number | undefined) ?? 0.5;
  const angularZSpeed = (cmdVelConfig?.angularZSpeed as number | undefined) ?? 0.5;

  const publishCmdVel = (linearX: number, linearY: number, angular: number) => {
    if (!connection.isConnected()) return;
    connection.publish(cmdVelTopic, 'geometry_msgs/Twist', {
      linear: { x: linearX, y: linearY, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    });
  };

  return (
    <div className="ManualControlPanel">
      <div className="ControlButtonRow">
        <button
          className="ControlButton"
          title="前进 (W / ↑)"
          onMouseDown={() => {
            activeKeysRef.current.add('ArrowUp');
            publishCmdVel(linearXSpeed, 0, 0);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('ArrowUp');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('ArrowUp');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          ↑
        </button>
      </div>
      <div className="ControlButtonRow">
        <button
          className="ControlButton"
          title="左转 (A / ←)"
          onMouseDown={() => {
            activeKeysRef.current.add('ArrowLeft');
            publishCmdVel(0, 0, angularZSpeed);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('ArrowLeft');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('ArrowLeft');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          ↶
        </button>
        <button
          className="ControlButton"
          title="后退 (S / ↓)"
          onMouseDown={() => {
            activeKeysRef.current.add('ArrowDown');
            publishCmdVel(-linearXSpeed, 0, 0);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('ArrowDown');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('ArrowDown');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          ↓
        </button>
        <button
          className="ControlButton"
          title="右转 (D / →)"
          onMouseDown={() => {
            activeKeysRef.current.add('ArrowRight');
            publishCmdVel(0, 0, -angularZSpeed);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('ArrowRight');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('ArrowRight');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          ↷
        </button>
      </div>
      <div className="ControlButtonRow">
        <button
          className="ControlButton"
          title="左移 (Z)"
          onMouseDown={() => {
            activeKeysRef.current.add('z');
            publishCmdVel(0, linearYSpeed, 0);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('z');
            activeKeysRef.current.delete('Z');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('z');
            activeKeysRef.current.delete('Z');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          ←
        </button>
        <button
          className="ControlButton"
          title="右移 (X)"
          onMouseDown={() => {
            activeKeysRef.current.add('x');
            publishCmdVel(0, -linearYSpeed, 0);
          }}
          onMouseUp={() => {
            activeKeysRef.current.delete('x');
            activeKeysRef.current.delete('X');
            publishCmdVel(0, 0, 0);
          }}
          onMouseLeave={() => {
            activeKeysRef.current.delete('x');
            activeKeysRef.current.delete('X');
            publishCmdVel(0, 0, 0);
          }}
          type="button"
        >
          →
        </button>
      </div>
    </div>
  );
}

