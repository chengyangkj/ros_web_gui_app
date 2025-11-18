import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';

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

  update(message: unknown): void {
    const msg = message as PolygonStamped;
    if (!msg.polygon || !msg.polygon.points || !Array.isArray(msg.polygon.points) || msg.polygon.points.length === 0) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh = null;
        this.object3D = null;
      }
      return;
    }

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }

    const points = msg.polygon.points;
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      vertices.push(point.x, point.y, 0);
    }

    if (points.length >= 3) {
      for (let i = 1; i < points.length - 1; i++) {
        indices.push(0, i, i + 1);
      }
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
    });

    const mesh = new THREE.Mesh(geometry, material);
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

