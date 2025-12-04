import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';

interface ImageMessage {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nanosec?: number;
      nsec?: number;
    };
  };
  height: number;
  width: number;
  encoding: string;
  is_bigendian: number;
  step: number;
  data: number[] | Uint8Array;
}

interface CompressedImageMessage {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nanosec?: number;
      nsec?: number;
    };
  };
  format: string;
  data: number[] | Uint8Array;
}

export interface ImageLayerData {
  imageUrl: string;
  width: number;
  height: number;
  layerId: string;
}

export class ImageLayer extends BaseLayer {
  private imageUrl: string | null = null;
  private imageWidth: number = 0;
  private imageHeight: number = 0;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    if (config.topic) {
      this.subscribe(config.topic, this.getMessageType());
    }
  }

  getMessageType(): string | null {
    if (this.config.messageType) {
      return this.config.messageType as string;
    }
    
    const topic = this.config.topic;
    if (!topic) return null;
    
    if (this.connection) {
      const topicType = this.connection.getTopicType(topic);
      if (topicType) {
        return topicType;
      }
    }
    
    if (topic.includes('compressed')) {
      return 'sensor_msgs/CompressedImage';
    }
    return 'sensor_msgs/Image';
  }

  update(message: unknown): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      let imageUrl: string | null = null;
      let width = 0;
      let height = 0;

      if ('format' in (message as any)) {
        const msg = message as CompressedImageMessage;
        imageUrl = this.decodeCompressedImage(msg);
        width = 0;
        height = 0;
      } else {
        const msg = message as ImageMessage;
        imageUrl = this.decodeImage(msg);
        width = msg.width || 0;
        height = msg.height || 0;
      }

      if (imageUrl) {
        this.imageUrl = imageUrl;
        this.imageWidth = width;
        this.imageHeight = height;
        this.notifyImageUpdate();
      }
    } catch (error) {
      console.error('[ImageLayer] Failed to decode image:', error);
    }
  }

  private decodeCompressedImage(msg: CompressedImageMessage): string | null {
    try {
      let data: Uint8Array;
      if (Array.isArray(msg.data)) {
        data = new Uint8Array(msg.data);
      } else if (msg.data instanceof Uint8Array) {
        data = new Uint8Array(msg.data);
      } else {
        data = new Uint8Array(Array.from(msg.data));
      }
      
      const format = msg.format || 'jpeg';
      const mimeType = format === 'png' ? 'image/png' : format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
      const blob = new Blob([data as BlobPart], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('[ImageLayer] Failed to decode compressed image:', error);
      return null;
    }
  }

  private decodeImage(msg: ImageMessage): string | null {
    try {
      const data = Array.isArray(msg.data) ? new Uint8Array(msg.data) : msg.data;
      const encoding = msg.encoding || 'rgb8';
      const width = msg.width || 1;
      const height = msg.height || 1;
      const step = msg.step || width * (encoding.includes('8UC3') || encoding === 'bgr8' || encoding === 'rgb8' ? 3 : encoding === 'rgba8' || encoding === 'bgra8' ? 4 : 1);
      const is_bigendian = msg.is_bigendian || false;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const imageDataObj = ctx.createImageData(width, height);
      const output = imageDataObj.data;
      
      this.decodeRawImage(data, encoding, width, height, step, !!is_bigendian, output);
      
      ctx.putImageData(imageDataObj, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('[ImageLayer] Failed to decode image:', error);
      return null;
    }
  }

  private decodeRawImage(
    rawData: Uint8Array,
    encoding: string,
    width: number,
    height: number,
    step: number,
    is_bigendian: boolean,
    output: Uint8ClampedArray,
  ): void {
    switch (encoding) {
      case 'rgb8':
        this.decodeRGB8(rawData, width, height, step, output);
        break;
      case 'rgba8':
        this.decodeRGBA8(rawData, width, height, step, output);
        break;
      case 'bgra8':
        this.decodeBGRA8(rawData, width, height, step, output);
        break;
      case 'bgr8':
      case '8UC3':
        this.decodeBGR8(rawData, width, height, step, output);
        break;
      case 'mono8':
      case '8UC1':
        this.decodeMono8(rawData, width, height, step, output);
        break;
      case 'mono16':
      case '16UC1':
        this.decodeMono16(rawData, width, height, step, !!is_bigendian, output);
        break;
      case 'yuv422':
      case 'uyvy':
        this.decodeUYVY(rawData, width, height, step, output);
        break;
      case 'yuv422_yuy2':
      case 'yuyv':
        this.decodeYUYV(rawData, width, height, step, output);
        break;
      default:
        throw new Error(`Unsupported encoding: ${encoding}`);
    }
  }

  private decodeRGB8(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x * 3;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex + 2 < data.length && dstIndex + 3 < output.length) {
          output[dstIndex] = data[srcIndex];
          output[dstIndex + 1] = data[srcIndex + 1];
          output[dstIndex + 2] = data[srcIndex + 2];
          output[dstIndex + 3] = 255;
        }
      }
    }
  }

  private decodeRGBA8(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x * 4;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex + 3 < data.length && dstIndex + 3 < output.length) {
          output[dstIndex] = data[srcIndex];
          output[dstIndex + 1] = data[srcIndex + 1];
          output[dstIndex + 2] = data[srcIndex + 2];
          output[dstIndex + 3] = data[srcIndex + 3];
        }
      }
    }
  }

  private decodeBGR8(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x * 3;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex + 2 < data.length && dstIndex + 3 < output.length) {
          output[dstIndex] = data[srcIndex + 2];
          output[dstIndex + 1] = data[srcIndex + 1];
          output[dstIndex + 2] = data[srcIndex];
          output[dstIndex + 3] = 255;
        }
      }
    }
  }

  private decodeBGRA8(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x * 4;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex + 3 < data.length && dstIndex + 3 < output.length) {
          output[dstIndex] = data[srcIndex + 2];
          output[dstIndex + 1] = data[srcIndex + 1];
          output[dstIndex + 2] = data[srcIndex];
          output[dstIndex + 3] = data[srcIndex + 3];
        }
      }
    }
  }

  private decodeMono8(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex < data.length && dstIndex + 3 < output.length) {
          const value = data[srcIndex];
          output[dstIndex] = value;
          output[dstIndex + 1] = value;
          output[dstIndex + 2] = value;
          output[dstIndex + 3] = 255;
        }
      }
    }
  }

  private decodeMono16(data: Uint8Array, width: number, height: number, step: number, is_bigendian: boolean, output: Uint8ClampedArray): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const bigEndian = !!is_bigendian;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x++) {
        const srcIndex = rowOffset + x * 2;
        const dstIndex = (y * width + x) * 4;
        if (srcIndex + 1 < data.length && dstIndex + 3 < output.length) {
          const value = view.getUint16(srcIndex, bigEndian);
          const normalized = Math.min(255, Math.floor((value / 65535) * 255));
          output[dstIndex] = normalized;
          output[dstIndex + 1] = normalized;
          output[dstIndex + 2] = normalized;
          output[dstIndex + 3] = 255;
        }
      }
    }
  }

  private decodeUYVY(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x += 2) {
        const srcIndex = rowOffset + (x / 2) * 4;
        if (srcIndex + 3 < data.length) {
          const u = data[srcIndex];
          const y1 = data[srcIndex + 1];
          const v = data[srcIndex + 2];
          const y2 = data[srcIndex + 3];
          
          const rgb1 = this.yuvToRgb(y1, u, v);
          const rgb2 = this.yuvToRgb(y2, u, v);
          
          const dstIndex1 = (y * width + x) * 4;
          const dstIndex2 = (y * width + x + 1) * 4;
          if (dstIndex1 + 3 < output.length) {
            output[dstIndex1] = rgb1.r;
            output[dstIndex1 + 1] = rgb1.g;
            output[dstIndex1 + 2] = rgb1.b;
            output[dstIndex1 + 3] = 255;
          }
          if (dstIndex2 + 3 < output.length) {
            output[dstIndex2] = rgb2.r;
            output[dstIndex2 + 1] = rgb2.g;
            output[dstIndex2 + 2] = rgb2.b;
            output[dstIndex2 + 3] = 255;
          }
        }
      }
    }
  }

  private decodeYUYV(data: Uint8Array, width: number, height: number, step: number, output: Uint8ClampedArray): void {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * step;
      for (let x = 0; x < width; x += 2) {
        const srcIndex = rowOffset + (x / 2) * 4;
        if (srcIndex + 3 < data.length) {
          const y1 = data[srcIndex];
          const u = data[srcIndex + 1];
          const y2 = data[srcIndex + 2];
          const v = data[srcIndex + 3];
          
          const rgb1 = this.yuvToRgb(y1, u, v);
          const rgb2 = this.yuvToRgb(y2, u, v);
          
          const dstIndex1 = (y * width + x) * 4;
          const dstIndex2 = (y * width + x + 1) * 4;
          if (dstIndex1 + 3 < output.length) {
            output[dstIndex1] = rgb1.r;
            output[dstIndex1 + 1] = rgb1.g;
            output[dstIndex1 + 2] = rgb1.b;
            output[dstIndex1 + 3] = 255;
          }
          if (dstIndex2 + 3 < output.length) {
            output[dstIndex2] = rgb2.r;
            output[dstIndex2 + 1] = rgb2.g;
            output[dstIndex2 + 2] = rgb2.b;
            output[dstIndex2 + 3] = 255;
          }
        }
      }
    }
  }

  private yuvToRgb(y: number, u: number, v: number): { r: number; g: number; b: number } {
    const c = y - 16;
    const d = u - 128;
    const e = v - 128;
    
    const r = Math.max(0, Math.min(255, Math.floor((298 * c + 409 * e + 128) >> 8)));
    const g = Math.max(0, Math.min(255, Math.floor((298 * c - 100 * d - 208 * e + 128) >> 8)));
    const b = Math.max(0, Math.min(255, Math.floor((298 * c + 516 * d + 128) >> 8)));
    
    return { r, g, b };
  }

  private notifyImageUpdate(): void {
    const event = new CustomEvent('imageLayerUpdate', {
      detail: {
        layerId: this.config.id,
        imageUrl: this.imageUrl,
        width: this.imageWidth,
        height: this.imageHeight,
      },
    });
    window.dispatchEvent(event);
  }

  getImageData(): ImageLayerData | null {
    if (!this.imageUrl) return null;
    return {
      imageUrl: this.imageUrl,
      width: this.imageWidth,
      height: this.imageHeight,
      layerId: this.config.id,
    };
  }

  dispose(): void {
    if (this.imageUrl && this.imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imageUrl);
    }
    this.imageUrl = null;
    super.dispose();
  }
}

