import { useEffect } from 'react';
import type { RosbridgeConnection } from '../utils/RosbridgeConnection';

export function useManualControl(
  manualControlMode: boolean,
  connection: RosbridgeConnection,
  cmdVelTopicRef: React.MutableRefObject<string>,
  activeKeysRef: React.MutableRefObject<Set<string>>,
  cmdVelIntervalRef: React.MutableRefObject<number | null>
) {
  useEffect(() => {
    const publishCmdVel = (linearX: number, linearY: number, angular: number) => {
      if (!connection.isConnected()) return;
      const message = {
        linear: { x: linearX, y: linearY, z: 0 },
        angular: { x: 0, y: 0, z: angular },
      };
      connection.publish(cmdVelTopicRef.current, 'geometry_msgs/Twist', message);
    };

    if (!manualControlMode) {
      if (cmdVelIntervalRef.current !== null) {
        clearInterval(cmdVelIntervalRef.current);
        cmdVelIntervalRef.current = null;
      }
      activeKeysRef.current.clear();
      publishCmdVel(0, 0, 0);
      return;
    }

    const updateCmdVel = () => {
      let linearX = 0;
      let linearY = 0;
      let angular = 0;
      const keys = activeKeysRef.current;

      if (keys.has('w') || keys.has('W') || keys.has('ArrowUp')) {
        linearX = 0.5;
      }
      if (keys.has('s') || keys.has('S') || keys.has('ArrowDown')) {
        linearX = -0.5;
      }
      if (keys.has('a') || keys.has('A') || keys.has('ArrowLeft')) {
        angular = 0.5;
      }
      if (keys.has('d') || keys.has('D') || keys.has('ArrowRight')) {
        angular = -0.5;
      }
      if (keys.has('z') || keys.has('Z')) {
        linearY = 0.5;
      }
      if (keys.has('x') || keys.has('X')) {
        linearY = -0.5;
      }

      publishCmdVel(linearX, linearY, angular);
    };

    cmdVelIntervalRef.current = window.setInterval(updateCmdVel, 100);

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'z', 'x', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        activeKeysRef.current.add(e.key);
        updateCmdVel();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      activeKeysRef.current.delete(e.key);
      updateCmdVel();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (cmdVelIntervalRef.current !== null) {
        clearInterval(cmdVelIntervalRef.current);
        cmdVelIntervalRef.current = null;
      }
      activeKeysRef.current.clear();
      publishCmdVel(0, 0, 0);
    };
  }, [manualControlMode, connection, cmdVelTopicRef, activeKeysRef, cmdVelIntervalRef]);
}

