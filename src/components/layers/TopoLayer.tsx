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
  private routeLines: THREE.Group[] = [];
  private routeMeshMap: Map<THREE.Mesh, Route> = new Map();
  private pointSize: number = 0.3;
  private color: number = 0x2196f3;
  private routeColor: number = 0x6b7280; // 路线颜色，默认灰色
  private animationValue: number = 0.0;
  private animationInterval: ReturnType<typeof setInterval> | null = null;
  private count: number = 2;
  private lastPoints: TopoPoint[] = [];
  private lastRoutes: Route[] = [];
  private selectedRoute: Route | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.color = (config as any).color || 0x2196f3;
    this.routeColor = (config as any).routeColor || 0x6b7280;
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
    this.lastRoutes = msg.routes || [];
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

    this.updateRoutes();
  }

  private updateRoutes(): void {
    // 清除旧的路线
    for (const lineGroup of this.routeLines) {
      this.scene.remove(lineGroup);
      this.disposeRouteLine(lineGroup);
    }
    this.routeLines = [];
    this.routeMeshMap.clear();

    if (!this.lastRoutes || this.lastRoutes.length === 0) {
      return;
    }

    // 创建点名称到坐标的映射
    const pointMap = new Map<string, { x: number; y: number }>();
    for (const point of this.lastPoints) {
      pointMap.set(point.name, { x: point.x, y: point.y });
    }

    // 统计每条路径的连接数量以判断是否为双向
    const connectionMap = new Map<string, Route[]>();
    for (const route of this.lastRoutes) {
      const key = this.getConnectionKey(route.from_point, route.to_point);
      if (!connectionMap.has(key)) {
        connectionMap.set(key, []);
      }
      connectionMap.get(key)!.push(route);
    }

    // 绘制路径
    for (const [, routeList] of connectionMap.entries()) {
      const firstRoute = routeList[0]!;
      const fromPoint = pointMap.get(firstRoute.from_point);
      const toPoint = pointMap.get(firstRoute.to_point);

      if (fromPoint && toPoint) {
        const isBidirectional = routeList.length > 1;
        
        if (isBidirectional) {
          // 双向路径：找到两个方向的路线
          const forwardRoute = routeList.find(r => r.from_point === firstRoute.from_point && r.to_point === firstRoute.to_point);
          const backwardRoute = routeList.find(r => r.from_point === firstRoute.to_point && r.to_point === firstRoute.from_point);
          
          // 创建双向路线，分别传递对应的 route
          const lineGroup = this.createRouteLine(
            fromPoint.x,
            fromPoint.y,
            toPoint.x,
            toPoint.y,
            true,
            forwardRoute,
            backwardRoute
          );
          this.routeLines.push(lineGroup);
          this.scene.add(lineGroup);
        } else {
          // 单向路径
          const lineGroup = this.createRouteLine(
            fromPoint.x,
            fromPoint.y,
            toPoint.x,
            toPoint.y,
            false,
            firstRoute
          );
          this.routeLines.push(lineGroup);
          this.scene.add(lineGroup);
        }
      }
    }
  }

  private getConnectionKey(from: string, to: string): string {
    const sorted = [from, to].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  private createRouteLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    bidirectional: boolean,
    forwardRoute?: Route,
    backwardRoute?: Route
  ): THREE.Group {
    const group = new THREE.Group();
    const pointBaseZ = 0.002; // 点位基础 z 位置（与点位 group 的 z 位置一致）
    const pointHeight = this.pointSize * 2; // 点位高度
    const lineHeight = this.pointSize * 0.3; // 路线高度
    const lineZ = pointBaseZ + pointHeight / 2; // 路线中心位置，对齐到点位高度的一半

    // 计算方向向量
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) {
      return group;
    }

    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;

    // 缩短线段到点位边缘
    const pointRadius = this.pointSize;
    const adjustedX1 = x1 + normalizedDx * pointRadius;
    const adjustedY1 = y1 + normalizedDy * pointRadius;
    const adjustedX2 = x2 - normalizedDx * pointRadius;
    const adjustedY2 = y2 - normalizedDy * pointRadius;

    if (bidirectional) {
      // 双向路径：绘制两条稍微偏移的线
      const offset = 0.05; // 偏移距离
      const perpDx = -normalizedDy * offset;
      const perpDy = normalizedDx * offset;

      // 第一条线（正向：从 from_point 到 to_point）
      const line1 = this.createLine(
        adjustedX1 + perpDx,
        adjustedY1 + perpDy,
        adjustedX2 + perpDx,
        adjustedY2 + perpDy,
        lineHeight,
        lineZ,
        forwardRoute
      );
      group.add(line1);

      // 第二条线（反向：从 to_point 到 from_point）
      const line2 = this.createLine(
        adjustedX1 - perpDx,
        adjustedY1 - perpDy,
        adjustedX2 - perpDx,
        adjustedY2 - perpDy,
        lineHeight,
        lineZ,
        backwardRoute
      );
      group.add(line2);

      // 绘制双向箭头
      this.addArrows(group, adjustedX1 + perpDx, adjustedY1 + perpDy, adjustedX2 + perpDx, adjustedY2 + perpDy, normalizedDx, normalizedDy, lineHeight, lineZ);
      this.addArrows(group, adjustedX2 - perpDx, adjustedY2 - perpDy, adjustedX1 - perpDx, adjustedY1 - perpDy, -normalizedDx, -normalizedDy, lineHeight, lineZ);
    } else {
      // 单向路径
      const line = this.createLine(adjustedX1, adjustedY1, adjustedX2, adjustedY2, lineHeight, lineZ, forwardRoute);
      group.add(line);

      // 绘制单向箭头
      this.addArrows(group, adjustedX1, adjustedY1, adjustedX2, adjustedY2, normalizedDx, normalizedDy, lineHeight, lineZ);
    }

    return group;
  }

  private createLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    height: number,
    z: number,
    route?: Route
  ): THREE.Mesh {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const geometry = new THREE.BoxGeometry(distance, 0.02, height);
    
    // 判断是否为选中状态
    const isSelected = route && this.selectedRoute && 
      route.from_point === this.selectedRoute.from_point &&
      route.to_point === this.selectedRoute.to_point;
    
    const material = new THREE.MeshBasicMaterial({
      color: isSelected ? 0xff0000 : this.routeColor, // 选中为红色，否则使用路线颜色
      transparent: true,
      opacity: isSelected ? 0.8 : 0.6,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
    mesh.rotation.z = angle;
    
    // 添加点击检测标识
    mesh.userData.isTopoRoute = true;
    if (route) {
      mesh.userData.topoRoute = route;
      this.routeMeshMap.set(mesh, route);
    }

    return mesh;
  }

  private addArrows(
    group: THREE.Group,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dirX: number,
    dirY: number,
    height: number,
    lineZ: number
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return;

    const arrowSpacing = 0.3; // 增加间距，让箭头更稀疏
    const triangleSize = 0.05;
    const perpX = -dirY;
    const perpY = dirX;

    let currentDistance = triangleSize;
    while (currentDistance < distance - triangleSize) {
      const distanceRatio = currentDistance / distance;
      const opacity = Math.max(0.5, 0.8 - distanceRatio * 0.3);

      const centerX = x1 + dirX * currentDistance;
      const centerY = y1 + dirY * currentDistance;

      // 箭头高度与路线一致，稍微提高确保显示在线的上方
      const arrowHeight = lineZ + height / 2 + 0.01;

      // 创建箭头三角形
      const arrowGeometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        centerX + dirX * triangleSize,
        centerY + dirY * triangleSize,
        arrowHeight,
        centerX - dirX * triangleSize * 0.5 + perpX * triangleSize * 0.5,
        centerY - dirY * triangleSize * 0.5 + perpY * triangleSize * 0.5,
        arrowHeight,
        centerX - dirX * triangleSize * 0.5 - perpX * triangleSize * 0.5,
        centerY - dirY * triangleSize * 0.5 - perpY * triangleSize * 0.5,
        arrowHeight,
      ]);
      arrowGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      arrowGeometry.computeVertexNormals();

      const arrowMaterial = new THREE.MeshBasicMaterial({
        color: this.routeColor,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
      });

      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      group.add(arrow);

      currentDistance += arrowSpacing;
    }
  }

  setSelectedRoute(route: Route | null): void {
    if (this.selectedRoute === route) {
      return;
    }
    
    this.selectedRoute = route;
    
    // 更新所有路线的颜色
    for (const [mesh, meshRoute] of this.routeMeshMap.entries()) {
      const isSelected = route && 
        meshRoute.from_point === route.from_point &&
        meshRoute.to_point === route.to_point;
      
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.color.setHex(isSelected ? 0xff0000 : this.routeColor);
        mesh.material.opacity = isSelected ? 0.8 : 0.6;
      }
    }
  }

  private disposeRouteLine(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.routeMeshMap.delete(child);
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
    const oldRouteColor = this.routeColor;
    const oldPointSize = this.pointSize;
    this.color = (config as any).color || 0x2196f3;
    this.routeColor = (config as any).routeColor || 0x6b7280;
    this.pointSize = (config as any).pointSize || 0.3;

    if (oldColor !== this.color || oldRouteColor !== this.routeColor || oldPointSize !== this.pointSize) {
      const savedPoints = [...this.lastPoints];
      const savedRoutes = [...this.lastRoutes];
      
      for (const [, group] of this.pointGroups.entries()) {
        this.scene.remove(group);
        this.disposePointGroup(group);
      }
      this.pointGroups.clear();
      
      for (const lineGroup of this.routeLines) {
        this.scene.remove(lineGroup);
        this.disposeRouteLine(lineGroup);
      }
      this.routeLines = [];
      
      if (savedPoints.length > 0) {
        const msg: TopologyMap = { points: savedPoints, routes: savedRoutes, map_name: '' };
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
    for (const lineGroup of this.routeLines) {
      this.scene.remove(lineGroup);
      this.disposeRouteLine(lineGroup);
    }
    this.routeLines = [];
    super.dispose();
  }
}

