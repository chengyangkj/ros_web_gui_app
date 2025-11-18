import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';

interface OccupancyGrid {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  info: {
    map_load_time: {
      sec: number;
      nsec: number;
    };
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[];
}

export class OccupancyGridLayer extends BaseLayer {
  private mesh: THREE.Mesh | null = null;

  update(message: unknown): void {
    const msg = message as OccupancyGrid;
    if (!msg.info || !msg.data) {
      return;
    }

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }

    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;

    const geometry = new THREE.PlaneGeometry(width * resolution, height * resolution);
    const texture = this.createMapTexture(msg.data, width, height);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(
      origin.position.x + (width * resolution) / 2,
      origin.position.y + (height * resolution) / 2,
      0
    );

    this.mesh = mesh;
    this.object3D = mesh;
    this.scene.add(mesh);
  }

  private createMapTexture(data: number[], width: number, height: number): THREE.DataTexture {
    const size = width * height;
    const rgba = new Uint8ClampedArray(size * 4);

    for (let i = 0; i < size; i++) {
      const value = data[i] ?? -1;
      const offset = i * 4;

      if (value === -1) {
        rgba[offset + 0] = 128;
        rgba[offset + 1] = 128;
        rgba[offset + 2] = 128;
        rgba[offset + 3] = 255;
      } else if (value >= 0 && value <= 100) {
        const gray = Math.trunc(255 - (255 * value) / 100);
        rgba[offset + 0] = gray;
        rgba[offset + 1] = gray;
        rgba[offset + 2] = gray;
        rgba[offset + 3] = 255;
      } else {
        rgba[offset + 0] = 255;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 255;
        rgba[offset + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
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

