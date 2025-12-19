import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';
import {
  stringToRgba,
  srgbToLinearUint8,
  paletteColorCached,
  rgbaToCssString,
} from '../../utils/colorUtils';
import type { ColorModes } from '../../utils/colorUtils';
import { MapManager, type OccupancyGrid } from '../../utils/MapManager';


interface OccupancyGridSettings {
  colorMode?: ColorModes;
  minColor?: string;
  maxColor?: string;
  unknownColor?: string;
  invalidColor?: string;
  alpha?: number;
  height?: number;
}

const DEFAULT_MIN_COLOR = { r: 1, g: 1, b: 1, a: 1 };
const DEFAULT_MAX_COLOR = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT_UNKNOWN_COLOR = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
const DEFAULT_INVALID_COLOR = { r: 1, g: 0, b: 1, a: 1 };

export class OccupancyGridLayer extends BaseLayer {
  private mesh: THREE.Mesh | null = null;
  protected texture: THREE.DataTexture | null = null;
  private settings: OccupancyGridSettings;
  protected lastData: number[] | Int8Array | null = null;
  protected lastWidth: number = 0;
  protected lastHeight: number = 0;
  protected lastMessage: OccupancyGrid | null = null;
  protected mapManager: MapManager;
  private handleMapUpdate: ((map: OccupancyGrid | null) => void) | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.settings = {
      colorMode: (config.colorMode as ColorModes | undefined) || 'map',
      minColor: (config.minColor as string | undefined) || rgbaToCssString(DEFAULT_MIN_COLOR),
      maxColor: (config.maxColor as string | undefined) || rgbaToCssString(DEFAULT_MAX_COLOR),
      unknownColor: (config.unknownColor as string | undefined) || rgbaToCssString(DEFAULT_UNKNOWN_COLOR),
      invalidColor: (config.invalidColor as string | undefined) || rgbaToCssString(DEFAULT_INVALID_COLOR),
      alpha: (config.alpha as number | undefined) ?? 1.0,
      height: (config.height as number | undefined) ?? 0,
    };
    this.mapManager = MapManager.getInstance();
    
    console.log('[OccupancyGridLayer] Constructor', { 
      topic: config.topic, 
      enabled: this.config.enabled,
      layerId: config.id
    });
    
    if (config.topic === '/map') {
      console.log('[OccupancyGridLayer] Using MapManager for /map topic');
      this.handleMapUpdate = (map: OccupancyGrid | null) => {
        console.log('[OccupancyGridLayer] handleMapUpdate called', { 
          hasMap: !!map, 
          enabled: this.config.enabled,
          layerId: config.id
        });
        if (map && this.config.enabled) {
          console.log('[OccupancyGridLayer] Rendering map from MapManager', { 
            width: map.info?.width, 
            height: map.info?.height,
            layerId: config.id
          });
          this.renderMap(map);
        }
      };
      
      this.mapManager.addOccupancyGridListener(this.handleMapUpdate);
      console.log('[OccupancyGridLayer] Added listener to MapManager', { layerId: config.id });
      
      const currentMap = this.mapManager.getOccupancyGrid();
      console.log('[OccupancyGridLayer] Current map from MapManager', { 
        hasMap: !!currentMap, 
        enabled: this.config.enabled,
        layerId: config.id
      });
      if (currentMap && this.config.enabled) {
        console.log('[OccupancyGridLayer] Rendering initial map', { 
          width: currentMap.info?.width, 
          height: currentMap.info?.height,
          layerId: config.id
        });
        this.renderMap(currentMap);
      }
    } else {
      console.log('[OccupancyGridLayer] Direct subscription for topic:', config.topic, { layerId: config.id });
      if (config.topic) {
        this.subscribe(config.topic, this.getMessageType());
      }
    }
  }
  
  renderMap(msg: OccupancyGrid): void {
 
    if (!msg.info || !msg.data) {
      console.log('[OccupancyGridLayer] renderMap skipped: missing info or data');
      return;
    }

    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const size = width * height;

    if (msg.data.length !== size) {
      return;
    }

    if (!this.mesh) {
      const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
      geometry.translate(0.5, 0.5, 0);
      const texture = this.createTexture(width, height);
      const material = this.createMaterial(texture);
      const mesh = new THREE.Mesh(geometry, material);
      this.mesh = mesh;
      this.texture = texture;
      this.object3D = mesh;
      this.scene.add(mesh);
    }

    if (this.texture && (width !== this.texture.image.width || height !== this.texture.image.height)) {
      this.texture.dispose();
      this.texture = this.createTexture(width, height);
      (this.mesh.material as THREE.MeshBasicMaterial).map = this.texture;
    }

    this.updateTexture(this.texture!, msg.data, width, height);
    this.lastData = Array.isArray(msg.data) ? [...msg.data] : Array.from(msg.data);
    this.lastWidth = width;
    this.lastHeight = height;
    const clonedMsg = JSON.parse(JSON.stringify(msg));
    clonedMsg.data = Array.isArray(msg.data) ? [...msg.data] : Array.from(msg.data);
    this.lastMessage = clonedMsg;
    
    const mapWidth = width * resolution;
    const mapHeight = height * resolution;
    this.mesh.scale.set(mapWidth, mapHeight, 1);
    
    const originQuaternion = new THREE.Quaternion(
      origin.orientation.x,
      origin.orientation.y,
      origin.orientation.z,
      origin.orientation.w
    );
    
    this.mesh.position.set(
      origin.position.x,
      origin.position.y,
      origin.position.z + (this.settings.height ?? 0)
    );
    
    this.mesh.quaternion.copy(originQuaternion);
  }

  getMessageType(): string | null {
    return 'nav_msgs/OccupancyGrid';
  }

  setConnection(connection: RosbridgeConnection): void {
    console.log('[OccupancyGridLayer] setConnection called', { 
      topic: this.config.topic,
      layerId: this.config.id,
      isConnected: connection.isConnected()
    });
    this.connection = connection;
    
    if (this.config.topic === '/map') {
      console.log('[OccupancyGridLayer] Skipping BaseLayer subscription for /map topic, using MapManager instead', { layerId: this.config.id });
      return;
    }
    
    if (this.config.topic && connection.isConnected()) {
      console.log('[OccupancyGridLayer] Subscribing directly to topic:', this.config.topic, { layerId: this.config.id });
      this.subscribe(this.config.topic, this.getMessageType());
    }
  }

  update(message: unknown): void {
    const msg = message as OccupancyGrid;

    if (!msg.info || !msg.data) {
      console.log('[OccupancyGridLayer] update skipped: missing info or data', { layerId: this.config.id });
      return;
    }

    if (this.config.topic === '/map') {
      console.warn('[OccupancyGridLayer] update called for /map topic, but should use MapManager instead. Ignoring.', { layerId: this.config.id });
      return;
    } else {
      this.renderMap(msg);
    }
  }

  private createTexture(width: number, height: number): THREE.DataTexture {
    const size = width * height;
    const rgba = new Uint8ClampedArray(size * 4);
    const texture = new THREE.DataTexture(
      rgba,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.NearestFilter,
      THREE.LinearFilter,
      1,
      THREE.LinearSRGBColorSpace,
    );
    texture.generateMipmaps = false;
    return texture;
  }

  private createMaterial(texture: THREE.DataTexture): THREE.MeshBasicMaterial {
    const transparent = this.settings.alpha! < 1.0;
    return new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      alphaTest: 1e-4,
      depthWrite: !transparent,
      transparent,
      opacity: this.settings.alpha,
    });
  }

  updateTexture(texture: THREE.DataTexture, data: number[] | Int8Array, width: number, height: number): void {
    const size = width * height;
    const rgba = texture.image.data as Uint8ClampedArray;

    const tempMinColor = { r: 0, g: 0, b: 0, a: 0 };
    const tempMaxColor = { r: 0, g: 0, b: 0, a: 0 };
    const tempUnknownColor = { r: 0, g: 0, b: 0, a: 0 };
    const tempInvalidColor = { r: 0, g: 0, b: 0, a: 0 };
    const tempColor = { r: 0, g: 0, b: 0, a: 0 };

    if (this.settings.colorMode === 'custom') {
      stringToRgba(tempMinColor, this.settings.minColor!);
      stringToRgba(tempMaxColor, this.settings.maxColor!);
      stringToRgba(tempUnknownColor, this.settings.unknownColor!);
      stringToRgba(tempInvalidColor, this.settings.invalidColor!);

      srgbToLinearUint8(tempMinColor);
      srgbToLinearUint8(tempMaxColor);
      srgbToLinearUint8(tempUnknownColor);
      srgbToLinearUint8(tempInvalidColor);
    }

    for (let i = 0; i < size; i++) {
      const value = data[i]! | 0;
      const offset = i * 4;

      if (value === -1) {
        rgba[offset + 0] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
      } else if (this.settings.colorMode === 'custom') {
        if (value === 100) {
          rgba[offset + 0] = tempMaxColor.r;
          rgba[offset + 1] = tempMaxColor.g;
          rgba[offset + 2] = tempMaxColor.b;
          rgba[offset + 3] = Math.trunc(tempMaxColor.a * this.settings.alpha!);
        } else {
          rgba[offset + 0] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
          rgba[offset + 3] = 0;
        }
      } else {
        paletteColorCached(tempColor, value, this.settings.colorMode!);
        rgba[offset + 0] = tempColor.r;
        rgba[offset + 1] = tempColor.g;
        rgba[offset + 2] = tempColor.b;
        rgba[offset + 3] = Math.trunc(tempColor.a * this.settings.alpha!);
      }
    }

    texture.needsUpdate = true;
  }

  setConfig(config: LayerConfig): void {
    const oldTopic = this.config.topic;
    this.config = config;
    
    if (oldTopic !== config.topic && this.connection?.isConnected()) {
      if (oldTopic === '/map') {
        if (this.handleMapUpdate) {
          this.mapManager.removeOccupancyGridListener(this.handleMapUpdate);
          this.handleMapUpdate = null;
        }
        this.unsubscribe();
      } else {
        this.unsubscribe();
      }
      
      if (config.topic === '/map') {
        this.handleMapUpdate = (map: OccupancyGrid | null) => {
          if (map && this.config.enabled) {
            this.renderMap(map);
          }
        };
        this.mapManager.addOccupancyGridListener(this.handleMapUpdate);
        const currentMap = this.mapManager.getOccupancyGrid();
        if (currentMap && this.config.enabled) {
          this.renderMap(currentMap);
        }
      } else if (config.topic) {
        this.subscribe(config.topic, this.getMessageType());
      }
    }
    
    const oldHeight = this.settings.height;
    const oldAlpha = this.settings.alpha;
    const oldColorMode = this.settings.colorMode;
    this.settings = {
      colorMode: (config.colorMode as ColorModes | undefined) || 'map',
      minColor: (config.minColor as string | undefined) || rgbaToCssString(DEFAULT_MIN_COLOR),
      maxColor: (config.maxColor as string | undefined) || rgbaToCssString(DEFAULT_MAX_COLOR),
      unknownColor: (config.unknownColor as string | undefined) || rgbaToCssString(DEFAULT_UNKNOWN_COLOR),
      invalidColor: (config.invalidColor as string | undefined) || rgbaToCssString(DEFAULT_INVALID_COLOR),
      alpha: (config.alpha as number | undefined) ?? 1.0,
      height: (config.height as number | undefined) ?? 0,
    };
    
    if (this.mesh && oldHeight !== this.settings.height) {
      this.mesh.position.z = this.mesh.position.z - (oldHeight ?? 0) + (this.settings.height ?? 0);
    }
    
    if (this.mesh && (oldAlpha !== this.settings.alpha || oldColorMode !== this.settings.colorMode)) {
      const material = this.mesh.material as THREE.MeshBasicMaterial;
      const transparent = this.settings.alpha! < 1.0;
      material.transparent = transparent;
      material.opacity = this.settings.alpha ?? 1.0;
      material.depthWrite = !transparent;
      if (this.texture && this.lastData) {
        this.updateTexture(this.texture, this.lastData, this.lastWidth, this.lastHeight);
      }
    }
  }

  modifyCell(worldX: number, worldY: number, value: number): boolean {
    if (!this.lastMessage || !this.lastData || !this.mesh) {
      return false;
    }

    const resolution = this.lastMessage.info.resolution;
    const origin = this.lastMessage.info.origin;
    const width = this.lastWidth;
    const height = this.lastHeight;

    const localX = worldX - origin.position.x;
    const localY = worldY - origin.position.y;

    const gridX = Math.floor(localX / resolution);
    const gridY = Math.floor(localY / resolution);

    if (gridX < 0 || gridX >= width || gridY < 0 || gridY >= height) {
      return false;
    }

    const index = gridY * width + gridX;
    if (index >= 0 && index < this.lastData.length) {
      this.lastData[index] = value;
      this.updateTexture(this.texture!, this.lastData, width, height);
      
      if (this.lastMessage) {
        this.lastMessage.data = Array.isArray(this.lastData) ? [...this.lastData] : Array.from(this.lastData);
      }
      return true;
    }
    return false;
  }

  modifyCells(worldPositions: Array<{ x: number; y: number }>, value: number, brushSize: number = 1, initialValues?: Map<number, number>): Array<{ index: number; oldValue: number; newValue: number }> {
    if (!this.lastMessage || !this.lastData || !this.mesh) {
      return [];
    }

    const resolution = this.lastMessage.info.resolution;
    const origin = this.lastMessage.info.origin;
    const width = this.lastWidth;
    const height = this.lastHeight;
    const changes: Array<{ index: number; oldValue: number; newValue: number }> = [];
    const modifiedIndices = new Set<number>();

    for (const worldPos of worldPositions) {
      const localX = worldPos.x - origin.position.x;
      const localY = worldPos.y - origin.position.y;

      const centerGridX = Math.floor(localX / resolution);
      const centerGridY = Math.floor(localY / resolution);

      const radius = Math.ceil(brushSize / resolution / 2);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const gridX = centerGridX + dx;
          const gridY = centerGridY + dy;

          if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
            const dist = Math.sqrt(dx * dx + dy * dy) * resolution;
            if (dist <= brushSize / 2) {
              const index = gridY * width + gridX;
              if (index >= 0 && index < this.lastData.length && !modifiedIndices.has(index)) {
                modifiedIndices.add(index);
                const oldValue = initialValues?.has(index) ? initialValues.get(index)! : this.lastData[index];
                changes.push({ index, oldValue, newValue: value });
                this.lastData[index] = value;
              }
            }
          }
        }
      }
    }

    if (changes.length > 0) {
      this.updateTexture(this.texture!, this.lastData, width, height);
      if (this.lastMessage) {
        this.lastMessage.data = Array.isArray(this.lastData) ? [...this.lastData] : Array.from(this.lastData);
      }
    }

    return changes;
  }

  drawLine(startX: number, startY: number, endX: number, endY: number, value: number, lineWidth: number = 0.05): Array<{ index: number; oldValue: number; newValue: number }> {
    if (!this.lastMessage || !this.lastData || !this.mesh) {
      return [];
    }

    const resolution = this.lastMessage.info.resolution;
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) {
      return [];
    }

    const stepSize = resolution / 2;
    const steps = Math.ceil(length / stepSize);
    const positions: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      positions.push({
        x: startX + dx * t,
        y: startY + dy * t,
      });
    }

    return this.modifyCells(positions, value, lineWidth);
  }

  getMapMessage(): OccupancyGrid | null {
    if (this.lastMessage) {
      return this.lastMessage;
    }
    return this.mapManager.getOccupancyGrid();
  }

  dispose(): void {
    if (this.handleMapUpdate) {
      this.mapManager.removeOccupancyGridListener(this.handleMapUpdate);
      this.handleMapUpdate = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    super.dispose();
  }
}

