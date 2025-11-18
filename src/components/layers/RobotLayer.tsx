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
  private sprite: THREE.Sprite | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig) {
    super(scene, config);
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

  private createSVGTexture(): THREE.Texture {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(robotSvgUrl);
    texture.flipY = false;
    return texture;
  }

  private createRobot(): void {
    const robotGroup = new THREE.Group();

    const axesHelper = new THREE.AxesHelper(0.3);
    robotGroup.add(axesHelper);

    const arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      0.3,
      0xff0000
    );
    robotGroup.add(arrowHelper);

    const texture = this.createSVGTexture();
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.2, 0.2, 1);
    sprite.position.set(0, 0, 0);
    this.sprite = sprite;
    robotGroup.add(sprite);

    this.robotGroup = robotGroup;
    this.object3D = robotGroup;
    this.scene.add(robotGroup);
  }

  private updateRobotTransform(): void {
    if (!this.robotGroup) {
      return;
    }

    const transform = this.tf2js.findTransform(this.mapFrame, this.baseFrame);
    if (transform) {
      this.robotGroup.position.set(
        transform.translation.x,
        transform.translation.y,
        transform.translation.z
      );
      this.robotGroup.quaternion.copy(transform.rotation);
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
    if (this.sprite && this.sprite.material) {
      (this.sprite.material as THREE.SpriteMaterial).map?.dispose();
      this.sprite.material.dispose();
    }
    if (this.robotGroup) {
      this.scene.remove(this.robotGroup);
      this.disposeObject3D(this.robotGroup);
      this.robotGroup = null;
    }
    super.dispose();
  }
}

