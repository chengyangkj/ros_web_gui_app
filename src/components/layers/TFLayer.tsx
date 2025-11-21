import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';
import { TF2JS } from '../../utils/tf2js';

export class TFLayer extends BaseLayer {
  private frameGroups: Map<string, THREE.Group> = new Map();
  private tf2js: TF2JS;
  private transformChangeUnsubscribe: (() => void) | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private axesSize: number = 0.1;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.updateFrames();
    this.transformChangeUnsubscribe = this.tf2js.onTransformChange(() => {
      this.updateFrames();
    });
    this.updateInterval = setInterval(() => {
      this.updateFrames();
    }, 100);
  }

  getMessageType(): string | null {
    return null;
  }

  private updateFrames(): void {
    if (!this.config.enabled) {
      for (const frameId of this.frameGroups.keys()) {
        const group = this.frameGroups.get(frameId);
        if (group) {
          group.visible = false;
        }
      }
      return;
    }

    const frames = this.tf2js.getFrames();
    const currentFrameIds = new Set(this.frameGroups.keys());
    const enabledFrames = new Set((this.config.enabledFrames as string[] | undefined) || []);

    for (const frameId of frames) {
      const shouldShow = enabledFrames.size === 0 || enabledFrames.has(frameId);
      
      if (!currentFrameIds.has(frameId)) {
        this.createFrame(frameId);
      }
      
      const group = this.frameGroups.get(frameId);
      if (group) {
        group.visible = shouldShow;
      }
      
      this.updateFrameTransform(frameId);
    }

    for (const frameId of currentFrameIds) {
      if (!frames.includes(frameId)) {
        this.removeFrame(frameId);
      }
    }
  }

  private createFrame(frameId: string): void {
    const group = new THREE.Group();
    group.name = `${frameId}`;

    const axesHelper = new THREE.AxesHelper(this.axesSize);
    group.add(axesHelper);

    const showFrameNames = (this.config.showFrameNames as boolean | undefined) !== false;
    if (showFrameNames) {
      const label = this.createLabel(frameId);
      label.position.set(0, 0, this.axesSize + 0.02);
      group.add(label);
    }

    this.frameGroups.set(frameId, group);
    this.scene.add(group);
  }

  private createLabel(text: string): THREE.Group {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return new THREE.Group();
    }

    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.font = '24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.2, 0.05, 1);

    const labelGroup = new THREE.Group();
    labelGroup.name = `label_${text}`;
    labelGroup.add(sprite);
    return labelGroup;
  }

  private updateFrameTransform(frameId: string): void {
    const group = this.frameGroups.get(frameId);
    if (!group) {
      return;
    }

    const rootFrame = 'map';
    const transform = this.tf2js.findTransform(rootFrame, frameId);
    
    if (transform) {
      group.position.set(
        transform.translation.x,
        transform.translation.y,
        transform.translation.z
      );
      group.quaternion.copy(transform.rotation);
    } else {
      group.position.set(0, 0, 0);
      group.quaternion.set(0, 0, 0, 1);
    }
  }

  private removeFrame(frameId: string): void {
    const group = this.frameGroups.get(frameId);
    if (group) {
      this.scene.remove(group);
      this.disposeFrameGroup(group);
      this.frameGroups.delete(frameId);
    }
  }

  private disposeFrameGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  update(): void {
    // TF2JS 单例会自动处理消息更新，这里不需要处理
  }

  setConfig(config: LayerConfig): void {
    const oldEnabled = this.config.enabled;
    const oldShowFrameNames = (this.config.showFrameNames as boolean | undefined);
    const oldEnabledFrames = new Set((this.config.enabledFrames as string[] | undefined) || []);
    super.setConfig(config);
    
    const newEnabledFrames = new Set((config.enabledFrames as string[] | undefined) || []);
    const enabledFramesChanged = oldEnabledFrames.size !== newEnabledFrames.size || 
      Array.from(oldEnabledFrames).some(id => !newEnabledFrames.has(id)) ||
      Array.from(newEnabledFrames).some(id => !oldEnabledFrames.has(id));
    
    console.log('[TFLayer] setConfig - enabledFrames:', {
      old: Array.from(oldEnabledFrames),
      new: Array.from(newEnabledFrames),
      changed: enabledFramesChanged
    });
    
    if (oldEnabled !== config.enabled || enabledFramesChanged) {
      for (const frameId of this.frameGroups.keys()) {
        const group = this.frameGroups.get(frameId);
        if (group) {
          if (!config.enabled) {
            group.visible = false;
          } else {
            const shouldShow = newEnabledFrames.size === 0 || newEnabledFrames.has(frameId);
            console.log('[TFLayer] setConfig - frame:', frameId, 'shouldShow:', shouldShow, 'enabledFrames.size:', newEnabledFrames.size);
            group.visible = shouldShow;
          }
        }
      }
    }
    
    if (oldShowFrameNames !== (config.showFrameNames as boolean | undefined)) {
      const showFrameNames = (config.showFrameNames as boolean | undefined) !== false;
      const frames = this.tf2js.getFrames();
      for (const frameId of frames) {
        const group = this.frameGroups.get(frameId);
        if (group) {
          const existingLabel = group.children.find(child => child.name === `label_${frameId}`);
          if (showFrameNames && !existingLabel) {
            const label = this.createLabel(frameId);
            label.position.set(0, 0, this.axesSize + 0.02);
            group.add(label);
          } else if (!showFrameNames && existingLabel) {
            group.remove(existingLabel);
            this.disposeFrameGroup(existingLabel as THREE.Group);
          }
        }
      }
    }
    
    this.updateFrames();
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
    for (const frameId of this.frameGroups.keys()) {
      this.removeFrame(frameId);
    }
    this.frameGroups.clear();
    super.dispose();
  }
}

