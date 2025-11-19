import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';
import { TF2JS } from '../../utils/tf2js';

interface LaserScan {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[] | Float32Array;
  intensities: number[] | Float32Array;
}

export class LaserScanLayer extends BaseLayer {
  private points: THREE.Points | null = null;
  private tf2js: TF2JS;
  private targetFrame: string;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.targetFrame = (config as any).targetFrame || 'map';
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
  }

  getMessageType(): string | null {
    return 'sensor_msgs/LaserScan';
  }

  update(message: unknown): void {
    const msg = message as LaserScan;
    
    if (!msg || !msg.ranges || (msg.ranges.length === undefined)) {
      return;
    }

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }

    const sourceFrame = msg.header?.frame_id || '';
    if (!sourceFrame) {
      return;
    }

    const points: THREE.Vector3[] = [];
    const ranges = Array.isArray(msg.ranges) ? msg.ranges : Array.from(msg.ranges);
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      if (range >= msg.range_min && range <= msg.range_max && !isNaN(range) && isFinite(range)) {
        const angle = msg.angle_min + i * msg.angle_increment;
        const x = range * Math.cos(angle);
        const y = range * Math.sin(angle);
        points.push(new THREE.Vector3(x, y, 0.2));
      }
    }

    if (points.length === 0) {
      return;
    }

    let transformedPoints: THREE.Vector3[] = points;
    if (sourceFrame !== this.targetFrame) {
      const transformMatrix = this.tf2js.getTransformMatrix(sourceFrame, this.targetFrame);
      if (transformMatrix) {
        transformedPoints = points.map(point => point.clone().applyMatrix4(transformMatrix));
      } else {
        return;
      }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(transformedPoints);
    const material = new THREE.PointsMaterial({ color: 0xff0000, size: 0.1 });
    const pointsMesh = new THREE.Points(geometry, material);
    this.points = pointsMesh;
    this.object3D = pointsMesh;
    this.scene.add(pointsMesh);
  }

  dispose(): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    super.dispose();
  }
}


