export interface LayerConfig {
  id: string;
  name: string;
  topic: string | null;
  messageType: string | null;
  enabled: boolean;
  [key: string]: unknown;
}

export interface LayerConfigMap {
  [layerId: string]: LayerConfig;
}

