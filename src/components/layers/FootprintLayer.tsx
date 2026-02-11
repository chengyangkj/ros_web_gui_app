import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';
import { TF2JS } from '../../utils/tf2js';

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
  private tf2js: TF2JS;
  private mapFrame: string;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.mapFrame = (config.mapFrame as string | undefined) || 'map';
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

    const sourceFrame = msg.header?.frame_id || '';
    if (!sourceFrame) {
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

    const pointData = points
      .filter(p => typeof p.x === 'number' && typeof p.y === 'number')
      .map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));

    const transformedPoints = this.tf2js.transformPointsToFrame(pointData, sourceFrame, this.mapFrame);
    if (!transformedPoints) {
      console.warn('[FootprintLayer] Transform not found:', {
        sourceFrame,
        targetFrame: this.mapFrame,
        availableFrames: this.tf2js.getFrames()
      });
      return;
    }

    if (transformedPoints.length < 3) {
      return;
    }

    const vertices: number[] = [];
    for (const point of transformedPoints) {
      vertices.push(point.x, point.y, point.z+0.01);
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

  setConfig(config: LayerConfig): void {
    const cfg = config as LayerConfig & { mapFrame?: string };
    if (cfg.mapFrame) {
      this.mapFrame = cfg.mapFrame;
    }
    super.setConfig(config);
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

