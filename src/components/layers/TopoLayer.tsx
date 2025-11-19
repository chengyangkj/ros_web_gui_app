import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';

interface TopoPoint {
  name: string;
  x: number;
  y: number;
  theta: number;
  type: number;
}

interface RouteInfo {
  controller: string;
  goal_checker: string;
  speed_limit: number;
}

interface Route {
  from_point: string;
  to_point: string;
  route_info: RouteInfo;
}

interface TopologyMap {
  map_name: string;
  map_property?: {
    support_controllers?: string[];
    support_goal_checkers?: string[];
  };
  points: TopoPoint[];
  routes?: Route[];
}

export class TopoLayer extends BaseLayer {
  private pointGroups: Map<string, THREE.Group> = new Map();
  private pointSize: number = 0.3;
  private color: number = 0x0080ff;
  private animationValue: number = 0.0;
  private animationInterval: ReturnType<typeof setInterval> | null = null;
  private count: number = 2;
  private lastPoints: TopoPoint[] = [];

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.color = (config as any).color || 0x0080ff;
    this.pointSize = (config as any).pointSize || 0.3;
    this.count = (config as any).count || 2;
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
    this.startAnimation();
  }

  getMessageType(): string | null {
    return 'topology_msgs/msg/TopologyMap';
  }

  private createCubeGeometry(size: number, height: number = size * 2): THREE.BoxGeometry {
    return new THREE.BoxGeometry(size * 2, size * 2, height);
  }

  private createPointGroup(point: TopoPoint): THREE.Group {
    const group = new THREE.Group();
    group.name = point.name;

    const cubeHeight = this.pointSize * 2;
    
    for (let i = this.count; i >= 0; i--) {
      const opacity = 1.0 - ((i + this.animationValue) / (this.count + 1));
      const scale = (i + this.animationValue) / (this.count + 1);
      
      const cubeGeometry = this.createCubeGeometry(this.pointSize, cubeHeight);
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: opacity * 0.8,
        side: THREE.DoubleSide,
      });
      const cube = new THREE.Mesh(cubeGeometry, material);
      cube.rotation.z = Math.PI / 4;
      cube.name = `ripple_${i}`;
      cube.scale.set(scale, scale, scale);
      cube.position.set(0, 0, cubeHeight * scale / 2);
      cube.userData.isTopoPoint = true;
      cube.userData.topoPoint = point;
      group.add(cube);
    }

    const centerPulse = 1.0 + 0.1 * Math.sin(this.animationValue * 4 * Math.PI);
    const centerOpacity = 0.8 + 0.2 * Math.sin(this.animationValue * 2 * Math.PI);
    const centerGeometry = this.createCubeGeometry(this.pointSize / 3, cubeHeight / 3);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: centerOpacity,
      side: THREE.DoubleSide,
    });
    const centerCube = new THREE.Mesh(centerGeometry, centerMaterial);
    centerCube.rotation.z = Math.PI / 4;
    centerCube.name = 'center';
    centerCube.scale.set(centerPulse, centerPulse, centerPulse);
    centerCube.position.set(0, 0, (cubeHeight / 3) * centerPulse / 2);
    centerCube.userData.isTopoPoint = true;
    centerCube.userData.topoPoint = point;
    group.userData.isTopoPoint = true;
    group.userData.topoPoint = point;
    group.add(centerCube);

    const directionIndicator = this.createDirectionIndicator(point.theta);
    directionIndicator.position.set(0, 0, 0);
    group.add(directionIndicator);

    const label = this.createLabel(point.name);
    label.position.set(0, -(this.pointSize + 0.1), 0.002);
    group.add(label);

    group.position.set(point.x, point.y, 0.002);
    group.rotation.z = -point.theta;

    return group;
  }

  private startAnimation(): void {
    this.animationInterval = setInterval(() => {
      this.animationValue = (this.animationValue + 0.016) % 1.0;
      this.updateAnimation();
    }, 16);
  }

  private updateAnimation(): void {
    const cubeHeight = this.pointSize * 2;
    
    for (const [, group] of this.pointGroups.entries()) {
      const ripples = group.children.filter(child => child.name?.startsWith('ripple_'));
      for (const ripple of ripples) {
        const index = parseInt(ripple.name?.split('_')[1] || '0');
        const opacity = 1.0 - ((index + this.animationValue) / (this.count + 1));
        const scale = (index + this.animationValue) / (this.count + 1);
        
        if (ripple instanceof THREE.Mesh) {
          const material = ripple.material as THREE.MeshBasicMaterial;
          material.opacity = opacity * 0.8;
          ripple.scale.set(scale, scale, scale);
          ripple.position.z = cubeHeight * scale / 2;
        }
      }

      const center = group.children.find(child => child.name === 'center');
      if (center instanceof THREE.Mesh) {
        const centerPulse = 1.0 + 0.1 * Math.sin(this.animationValue * 4 * Math.PI);
        const centerOpacity = 0.8 + 0.2 * Math.sin(this.animationValue * 2 * Math.PI);
        const material = center.material as THREE.MeshBasicMaterial;
        material.opacity = centerOpacity;
        center.scale.set(centerPulse, centerPulse, centerPulse);
        center.position.z = (cubeHeight / 3) * centerPulse / 2;
      }
    }
  }

  private createLabel(text: string): THREE.Group {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return new THREE.Group();
    }

    canvas.width = 512;
    canvas.height = 128;
    context.fillStyle = '#000000';
    context.font = 'bold 32px Arial';
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
    sprite.scale.set(0.3, 0.08, 1);

    const labelGroup = new THREE.Group();
    labelGroup.name = `label_${text}`;
    labelGroup.add(sprite);
    return labelGroup;
  }

  private createDirectionIndicator(_theta: number): THREE.Group {
    const indicatorGroup = new THREE.Group();
    
    const arcGeometry = new THREE.RingGeometry(
      this.pointSize * 0.6,
      this.pointSize * 0.8,
      16,
      1,
      0,
      Math.PI / 6
    );
    const arcMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const arc = new THREE.Mesh(arcGeometry, arcMaterial);
    arc.rotation.z = -Math.PI / 12;
    indicatorGroup.add(arc);

    return indicatorGroup;
  }

  update(message: unknown): void {
    const msg = message as TopologyMap;
    if (!msg.points || !Array.isArray(msg.points)) {
      return;
    }
    console.log('msg', msg);
    this.lastPoints = msg.points;
    const currentPointNames = new Set(this.pointGroups.keys());
    const newPointNames = new Set<string>();

    for (const point of msg.points) {
      newPointNames.add(point.name);
      
      if (!this.pointGroups.has(point.name)) {
        const group = this.createPointGroup(point);
        this.pointGroups.set(point.name, group);
        this.scene.add(group);
      } else {
        const group = this.pointGroups.get(point.name)!;
        group.position.set(point.x, point.y, 0.01);
        group.rotation.z = -point.theta;
      }
    }

    for (const pointName of currentPointNames) {
      if (!newPointNames.has(pointName)) {
        const group = this.pointGroups.get(pointName);
        if (group) {
          this.scene.remove(group);
          this.disposePointGroup(group);
          this.pointGroups.delete(pointName);
        }
      }
    }
  }

  private disposePointGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
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
      } else if (child instanceof THREE.Sprite) {
        if (child.material) {
          if (child.material.map) {
            child.material.map.dispose();
          }
          child.material.dispose();
        }
      }
    });
  }

  setConfig(config: LayerConfig): void {
    super.setConfig(config);
    const oldColor = this.color;
    const oldPointSize = this.pointSize;
    this.color = (config as any).color || 0x0080ff;
    this.pointSize = (config as any).pointSize || 0.3;

    if (oldColor !== this.color || oldPointSize !== this.pointSize) {
      const savedPoints = [...this.lastPoints];
      
      for (const [, group] of this.pointGroups.entries()) {
        this.scene.remove(group);
        this.disposePointGroup(group);
      }
      this.pointGroups.clear();
      
      if (savedPoints.length > 0) {
        const msg: TopologyMap = { points: savedPoints, map_name: '' };
        this.update(msg);
      }
    }
  }

  dispose(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
    for (const [, group] of this.pointGroups.entries()) {
      this.scene.remove(group);
      this.disposePointGroup(group);
    }
    this.pointGroups.clear();
    super.dispose();
  }
}

