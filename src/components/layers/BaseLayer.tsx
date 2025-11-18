import * as THREE from 'three';
import type { LayerConfig } from '../../types/LayerConfig';

export interface LayerRenderable {
  dispose(): void;
  update(message: unknown): void;
  getObject3D(): THREE.Object3D | null;
}

export abstract class BaseLayer implements LayerRenderable {
  protected scene: THREE.Scene;
  protected config: LayerConfig;
  protected object3D: THREE.Object3D | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig) {
    this.scene = scene;
    this.config = config;
  }

  abstract update(message: unknown): void;

  dispose(): void {
    if (this.object3D) {
      this.scene.remove(this.object3D);
      this.disposeObject3D(this.object3D);
      this.object3D = null;
    }
  }

  getObject3D(): THREE.Object3D | null {
    return this.object3D;
  }

  protected disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  setConfig(config: LayerConfig): void {
    this.config = config;
  }

  getConfig(): LayerConfig {
    return this.config;
  }
}

