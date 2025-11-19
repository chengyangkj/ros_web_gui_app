import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';

interface Point {
  x: number;
  y: number;
  z: number;
}

interface PolygonStamped {
  header: {
    frame_id: string;
  };
  polygon: {
    points: Point[];
  };
}

export class FootprintLayer extends BaseLayer {
  private line: THREE.LineLoop | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
  }

  getMessageType(): string | null {
    return 'geometry_msgs/PolygonStamped';
  }

  update(message: unknown): void {
    const msg = message as PolygonStamped;
    
    if (!msg || !msg.polygon || !msg.polygon.points || !Array.isArray(msg.polygon.points) || msg.polygon.points.length === 0) {
      if (this.line) {
        this.scene.remove(this.line);
        this.line.geometry.dispose();
        (this.line.material as THREE.Material).dispose();
        this.line = null;
        this.object3D = null;
      }
      return;
    }

    const points = msg.polygon.points;
    
    if (points.length < 3) {
      console.warn('[FootprintLayer] Polygon needs at least 3 points, got:', points.length);
      return;
    }

    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
    }

    const vertices: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      if (typeof point.x !== 'number' || typeof point.y !== 'number') {
        console.warn('[FootprintLayer] Invalid point format:', point);
        return;
      }
      vertices.push(point.x, point.y, 0.002);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: false,
    });

    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = 1;
    this.line = line;
    this.object3D = line;
    this.scene.add(line);
  }

  dispose(): void {
    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    super.dispose();
  }
}

