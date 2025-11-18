import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';

interface OccupancyGrid {
  info?: {
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
    };
  };
}

export class GridLayer extends BaseLayer {
  private gridHelper: THREE.GridHelper | null = null;
  private resolution: number = 0.05;
  private mapWidth: number = 0;
  private mapHeight: number = 0;
  private mapOriginX: number = 0;
  private mapOriginY: number = 0;

  constructor(scene: THREE.Scene, config: any) {
    super(scene, config);
    this.createDefaultGrid();
  }

  private createDefaultGrid(): void {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.dispose();
    }

    const gridSize = 20;
    const divisions = 20;

    this.gridHelper = new THREE.GridHelper(gridSize, divisions, 0x444444, 0x222222);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.position.set(0, 0, 0);

    this.object3D = this.gridHelper;
    this.scene.add(this.gridHelper);
  }

  update(message: unknown): void {
    const msg = message as OccupancyGrid;

    if (!msg.info) {
      return;
    }

    const newResolution = msg.info.resolution;
    const newWidth = msg.info.width;
    const newHeight = msg.info.height;
    const newOriginX = msg.info.origin.position.x;
    const newOriginY = msg.info.origin.position.y;

    if (
      this.resolution === newResolution &&
      this.mapWidth === newWidth &&
      this.mapHeight === newHeight &&
      this.mapOriginX === newOriginX &&
      this.mapOriginY === newOriginY &&
      this.gridHelper
    ) {
      return;
    }

    this.resolution = newResolution;
    this.mapWidth = newWidth;
    this.mapHeight = newHeight;
    this.mapOriginX = newOriginX;
    this.mapOriginY = newOriginY;

    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.dispose();
    }

    const mapSizeX = this.mapWidth * this.resolution;
    const mapSizeY = this.mapHeight * this.resolution;

    const gridSize = Math.max(mapSizeX, mapSizeY) * 1.5;
    const divisions = Math.ceil(gridSize);

    this.gridHelper = new THREE.GridHelper(gridSize, divisions, 0x444444, 0x222222);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.position.set(
      this.mapOriginX + mapSizeX / 2,
      this.mapOriginY + mapSizeY / 2,
      0
    );

    this.object3D = this.gridHelper;
    this.scene.add(this.gridHelper);
  }

  dispose(): void {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.dispose();
      this.gridHelper = null;
    }
    super.dispose();
  }
}

