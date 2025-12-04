import type { LayerConfigMap } from '../types/LayerConfig';

const STORAGE_KEY = 'ros_web_gui_layer_configs';
const IMAGE_POSITIONS_STORAGE_KEY = 'ros_web_gui_image_positions';

export interface ImagePosition {
  x: number;
  y: number;
  scale: number;
}

export type ImagePositionsMap = Record<string, ImagePosition>;

export function saveLayerConfigs(configs: LayerConfigMap): void {
  try {
    const serialized = JSON.stringify(configs);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.error('Failed to save layer configs:', error);
  }
}

export function loadLayerConfigs(): LayerConfigMap | null {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized) {
      return JSON.parse(serialized) as LayerConfigMap;
    }
  } catch (error) {
    console.error('Failed to load layer configs:', error);
  }
  return null;
}

export function saveImagePositions(positions: ImagePositionsMap): void {
  try {
    const serialized = JSON.stringify(positions);
    localStorage.setItem(IMAGE_POSITIONS_STORAGE_KEY, serialized);
  } catch (error) {
    console.error('Failed to save image positions:', error);
  }
}

export function loadImagePositions(): ImagePositionsMap | null {
  try {
    const serialized = localStorage.getItem(IMAGE_POSITIONS_STORAGE_KEY);
    if (serialized) {
      return JSON.parse(serialized) as ImagePositionsMap;
    }
  } catch (error) {
    console.error('Failed to load image positions:', error);
  }
  return null;
}



