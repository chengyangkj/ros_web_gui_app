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
  private mesh: THREE.Mesh | null = null;

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
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh = null;
        this.object3D = null;
      }
      return;
    }

    const points = msg.polygon.points;
    
    if (points.length < 3) {
      console.warn('[FootprintLayer] Polygon needs at least 3 points, got:', points.length);
      return;
    }

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }

    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      if (typeof point.x !== 'number' || typeof point.y !== 'number') {
        console.warn('[FootprintLayer] Invalid point format:', point);
        return;
      }
      vertices.push(point.x, point.y, 0.002);
    }

    for (let i = 1; i < points.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthTest: true,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    this.mesh = mesh;
    this.object3D = mesh;
    this.scene.add(mesh);
  }

  dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    super.dispose();
  }
}

