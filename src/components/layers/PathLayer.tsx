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

interface Pose {
  position: Point;
  orientation: { x: number; y: number; z: number; w: number };
}

interface PoseStamped {
  pose: Pose;
}

interface Path {
  header: {
    frame_id: string;
  };
  poses: PoseStamped[];
}

export class PathLayer extends BaseLayer {
  private line: THREE.Line | null = null;
  private color: number;
  private lineWidth: number;
  private tf2js: TF2JS;
  private mapFrame: string;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.mapFrame = (config.mapFrame as string | undefined) || 'map';
    this.color = (config.color as number | undefined) || 0x00ff00;
    this.lineWidth = (config.lineWidth as number | undefined) ?? 1;
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
  }

  getMessageType(): string | null {
    return 'nav_msgs/Path';
  }

  update(message: unknown): void {
    const msg = message as Path;
    if (!msg.poses || !Array.isArray(msg.poses) || msg.poses.length === 0) {
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

    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
    }

    const pointData = msg.poses.map(poseStamped => ({
      x: poseStamped.pose.position.x,
      y: poseStamped.pose.position.y,
      z: poseStamped.pose.position.z + 0.01
    }));

    const transformedPoints = this.tf2js.transformPointsToFrame(pointData, sourceFrame, this.mapFrame);
    if (!transformedPoints) {
      console.warn('[PathLayer] Transform not found:', {
        sourceFrame,
        targetFrame: this.mapFrame,
        availableFrames: this.tf2js.getFrames()
      });
      return;
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(transformedPoints);
    const material = new THREE.LineBasicMaterial({ color: this.color, linewidth: this.lineWidth });
    const line = new THREE.Line(geometry, material);

    this.line = line;
    this.object3D = line;
    this.scene.add(line);
  }

  setConfig(config: LayerConfig): void {
    const cfg = config as LayerConfig & { mapFrame?: string };
    if (cfg.mapFrame) {
      this.mapFrame = cfg.mapFrame;
    }
    
    const oldColor = this.color;
    const oldLineWidth = this.lineWidth;
    this.color = (config.color as number | undefined) ?? this.color;
    this.lineWidth = (config.lineWidth as number | undefined) ?? this.lineWidth;
    
    if (this.line && (oldColor !== this.color || oldLineWidth !== this.lineWidth)) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
      this.object3D = null;
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

