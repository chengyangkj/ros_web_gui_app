import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import { TF2JS } from '../../utils/tf2js';
import robotSvgUrl from '../../assets/robot.svg?url';

export class RobotLayer extends BaseLayer {
  private robotGroup: THREE.Group | null = null;
  private tf2js: TF2JS;
  private baseFrame: string;
  private mapFrame: string;
  private transformChangeUnsubscribe: (() => void) | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private iconMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: any = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.baseFrame = (config as any).baseFrame || 'base_link';
    this.mapFrame = (config as any).mapFrame || 'map';
    this.createRobot();
    this.updateRobotTransform();
    this.transformChangeUnsubscribe = this.tf2js.onTransformChange(() => {
      this.updateRobotTransform();
    });
    this.updateInterval = setInterval(() => {
      this.updateRobotTransform();
    }, 100);
  }

  getMessageType(): string | null {
    return null;
  }

  private createSVGTexture(): Promise<THREE.Texture> {
    return new Promise<THREE.Texture>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 1024;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.flipY = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 16;
        resolve(texture);
      };
      img.onerror = () => {
        const loader = new THREE.TextureLoader();
        const texture = loader.load(robotSvgUrl);
        texture.flipY = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 16;
        resolve(texture);
      };
      img.src = robotSvgUrl;
    });
  }

  private createRobot(): void {
    const robotGroup = new THREE.Group();

    this.createSVGTexture().then((texture) => {
      if (!this.robotGroup) return;
      const geometry = new THREE.PlaneGeometry(0.2, 0.2);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        alphaTest: 0.1,
      });
      const iconMesh = new THREE.Mesh(geometry, material);
      iconMesh.position.set(0, 0, 0);
      iconMesh.rotation.set(0, 0, Math.PI / 4);
      this.iconMesh = iconMesh;
      robotGroup.add(iconMesh);
    }).catch((error) => {
      console.error('[RobotLayer] Failed to load SVG texture:', error);
    });

    this.robotGroup = robotGroup;
    this.object3D = robotGroup;
    this.scene.add(robotGroup);
  }

  private updateRobotTransform(): void {
    if (!this.robotGroup) {
      return;
    }

 
    const transform = this.tf2js.findTransform( this.mapFrame, this.baseFrame);
    if (transform) {
      // The transform gives us base_center's position and orientation in map frame
      this.robotGroup.position.set(
        transform.translation.x,
        transform.translation.y,
        transform.translation.z
      );
      this.robotGroup.quaternion.copy(transform.rotation);
    } else {
      console.warn('[RobotLayer] Transform not found:', {
        mapFrame: this.mapFrame,
        baseFrame: this.baseFrame,
        availableFrames: this.tf2js.getFrames()
      });
    }
  }

  update(_message: unknown): void {
    // TF2JS 单例会自动处理消息更新，这里不需要处理
  }

  setConfig(config: LayerConfig): void {
    super.setConfig(config);
    const cfg = config as any;
    if (cfg.baseFrame) {
      this.baseFrame = cfg.baseFrame;
    }
    if (cfg.mapFrame) {
      this.mapFrame = cfg.mapFrame;
    }
    this.updateRobotTransform();
  }

  dispose(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.transformChangeUnsubscribe) {
      this.transformChangeUnsubscribe();
      this.transformChangeUnsubscribe = null;
    }
    if (this.iconMesh) {
      if (this.iconMesh.geometry) {
        this.iconMesh.geometry.dispose();
      }
      if (this.iconMesh.material) {
        const material = this.iconMesh.material as THREE.MeshBasicMaterial;
        if (material.map) {
          material.map.dispose();
        }
        material.dispose();
      }
      this.iconMesh = null;
    }
    if (this.robotGroup) {
      this.scene.remove(this.robotGroup);
      this.disposeObject3D(this.robotGroup);
      this.robotGroup = null;
    }
    super.dispose();
  }
}

