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

interface OccupancyGrid {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  info: {
    map_load_time: {
      sec: number;
      nsec: number;
    };
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[] | Int8Array;
}

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
  private texture: THREE.DataTexture | null = null;
  private settings: OccupancyGridSettings;
  private lastData: number[] | Int8Array | null = null;
  private lastWidth: number = 0;
  private lastHeight: number = 0;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.settings = {
      colorMode: (config as any).colorMode || 'map',
      minColor: (config as any).minColor || rgbaToCssString(DEFAULT_MIN_COLOR),
      maxColor: (config as any).maxColor || rgbaToCssString(DEFAULT_MAX_COLOR),
      unknownColor: (config as any).unknownColor || rgbaToCssString(DEFAULT_UNKNOWN_COLOR),
      invalidColor: (config as any).invalidColor || rgbaToCssString(DEFAULT_INVALID_COLOR),
      alpha: (config as any).alpha ?? 1.0,
      height: (config as any).height ?? 0,
    };
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
  }

  getMessageType(): string | null {
    return 'nav_msgs/OccupancyGrid';
  }

  update(message: unknown): void {
    const msg = message as OccupancyGrid;
    if (!msg.info || !msg.data) {
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
    this.lastData = msg.data;
    this.lastWidth = width;
    this.lastHeight = height;
    
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

  private updateTexture(texture: THREE.DataTexture, data: number[] | Int8Array, width: number, height: number): void {
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

      if (this.settings.colorMode === 'custom') {
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
    super.setConfig(config);
    const oldHeight = this.settings.height;
    const oldAlpha = this.settings.alpha;
    const oldColorMode = this.settings.colorMode;
    this.settings = {
      colorMode: (config as any).colorMode || 'map',
      minColor: (config as any).minColor || rgbaToCssString(DEFAULT_MIN_COLOR),
      maxColor: (config as any).maxColor || rgbaToCssString(DEFAULT_MAX_COLOR),
      unknownColor: (config as any).unknownColor || rgbaToCssString(DEFAULT_UNKNOWN_COLOR),
      invalidColor: (config as any).invalidColor || rgbaToCssString(DEFAULT_INVALID_COLOR),
      alpha: (config as any).alpha ?? 1.0,
      height: (config as any).height ?? 0,
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

  dispose(): void {
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

