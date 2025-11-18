import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';

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
  ranges: number[];
  intensities: number[];
}

export class LaserScanLayer extends BaseLayer {
  private points: THREE.Points | null = null;

  update(message: unknown): void {
    const msg = message as LaserScan;
    if (!msg.ranges || !Array.isArray(msg.ranges)) {
      return;
    }

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
    }

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < msg.ranges.length; i++) {
      const range = msg.ranges[i];
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

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.PointsMaterial({ color: 0xff0000, size: 0.05 });
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

