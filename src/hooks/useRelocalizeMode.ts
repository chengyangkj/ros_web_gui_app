import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LayerConfigMap } from '../types/LayerConfig';
import type { LayerManager } from '../components/layers/LayerManager';
import { TF2JS } from '../utils/tf2js';

export function useRelocalizeMode(
  relocalizeMode: boolean,
  viewMode: '2d' | '3d',
  layerConfigsRef: React.MutableRefObject<LayerConfigMap>,
  layerManagerRef: React.MutableRefObject<LayerManager | null>,
  controlsRef: React.MutableRefObject<OrbitControls | null>,
  relocalizeButtonRef: React.MutableRefObject<HTMLButtonElement | null>,
  relocalizeControlsRef: React.MutableRefObject<HTMLDivElement | null>,
  relocalizeRobotPosRef: React.MutableRefObject<{ x: number; y: number; theta: number } | null>,
  relocalizeModeRef: React.MutableRefObject<boolean>
) {
  const [relocalizeControlsStyle, setRelocalizeControlsStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    relocalizeModeRef.current = relocalizeMode;
    if (controlsRef.current) {
      if (relocalizeMode) {
        controlsRef.current.enablePan = false;
        controlsRef.current.enableRotate = false;
        controlsRef.current.enableZoom = true;
      } else {
        controlsRef.current.enablePan = true;
        controlsRef.current.enableRotate = viewMode === '3d';
        controlsRef.current.enableZoom = true;
      }
    }
  }, [relocalizeMode, viewMode, controlsRef, relocalizeModeRef]);

  useEffect(() => {
    const updateRelocalizeControlsPosition = () => {
      if (!relocalizeMode || !relocalizeButtonRef.current || !relocalizeControlsRef.current) {
        return;
      }

      const buttonRect = relocalizeButtonRef.current.getBoundingClientRect();
      
      const buttonRight = window.innerWidth - buttonRect.right;
      const buttonTop = buttonRect.top;
      const gap = 10;
      
      setRelocalizeControlsStyle({
        top: `${buttonTop}px`,
        right: `${buttonRight + buttonRect.width + gap}px`,
      });
    };

    if (relocalizeMode) {
      updateRelocalizeControlsPosition();
      
      const handleResize = () => {
        updateRelocalizeControlsPosition();
      };
      
      window.addEventListener('resize', handleResize);
      
      const timeoutId = setTimeout(() => {
        updateRelocalizeControlsPosition();
      }, 100);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(timeoutId);
      };
    } else {
      setRelocalizeControlsStyle({});
    }
  }, [relocalizeMode, layerConfigsRef, relocalizeButtonRef, relocalizeControlsRef]);

  useEffect(() => {
    if (relocalizeMode) {
      const robotConfig = layerConfigsRef.current.robot;
      if (robotConfig) {
        const baseFrame = (robotConfig as any).baseFrame || 'base_link';
        const mapFrame = (robotConfig as any).mapFrame || 'map';
        const tf2js = TF2JS.getInstance();
        const transform = tf2js.findTransform(mapFrame, baseFrame);
        
        if (transform) {
          const robotEuler = new THREE.Euler();
          robotEuler.setFromQuaternion(transform.rotation, 'XYZ');
          const robotTheta = robotEuler.z;
          
          relocalizeRobotPosRef.current = {
            x: transform.translation.x,
            y: transform.translation.y,
            theta: robotTheta,
          };
          
          const robotLayer = layerManagerRef.current?.getLayer('robot');
          if (robotLayer && 'setRelocalizeMode' in robotLayer) {
            (robotLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
          }
          
          const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
          if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
            (laserScanLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
          }
        } else {
          relocalizeRobotPosRef.current = { x: 0, y: 0, theta: 0 };
          const robotLayer = layerManagerRef.current?.getLayer('robot');
          if (robotLayer && 'setRelocalizeMode' in robotLayer) {
            (robotLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
          }
          
          const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
          if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
            (laserScanLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
          }
        }
      }
    } else {
      relocalizeRobotPosRef.current = null;
      const robotLayer = layerManagerRef.current?.getLayer('robot');
      if (robotLayer && 'setRelocalizeMode' in robotLayer) {
        (robotLayer as any).setRelocalizeMode(false, null);
      }
      const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
      if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
        (laserScanLayer as any).setRelocalizeMode(false, null);
      }
    }
  }, [relocalizeMode, layerConfigsRef, layerManagerRef, relocalizeRobotPosRef]);
  
  useEffect(() => {
    if (relocalizeMode && relocalizeRobotPosRef.current) {
      const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
      if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
        (laserScanLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
      }
    }
  }, [relocalizeMode, relocalizeRobotPosRef, layerManagerRef]);

  return relocalizeControlsStyle;
}

