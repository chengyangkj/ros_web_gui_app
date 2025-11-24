import type { LayerConfigMap } from '../types/LayerConfig';

const STORAGE_KEY = 'ros_web_gui_layer_configs';

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



