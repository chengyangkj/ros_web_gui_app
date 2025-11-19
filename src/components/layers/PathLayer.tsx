import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';

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

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.color = (config as any).color || 0x00ff00;
    console.log('[PathLayer] Constructor:', { topic: config.topic, hasConnection: !!connection, isConnected: connection?.isConnected(), color: this.color });
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
      console.log('[PathLayer] No poses or empty poses');
      if (this.line) {
        this.scene.remove(this.line);
        this.line.geometry.dispose();
        (this.line.material as THREE.Material).dispose();
        this.line = null;
        this.object3D = null;
      }
      return;
    }

    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
    }

    const points: THREE.Vector3[] = [];
    for (const poseStamped of msg.poses) {
      const pos = poseStamped.pose.position;
      points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: this.color });
    const line = new THREE.Line(geometry, material);

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

