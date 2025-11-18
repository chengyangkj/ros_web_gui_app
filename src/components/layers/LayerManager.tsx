import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import { GridLayer } from './GridLayer';
import { OccupancyGridLayer } from './OccupancyGridLayer';
import { LaserScanLayer } from './LaserScanLayer';
import { RobotLayer } from './RobotLayer';
import { PathLayer } from './PathLayer';
import { FootprintLayer } from './FootprintLayer';
import type { LayerConfig, LayerConfigMap } from '../../types/LayerConfig';
import { RosbridgeConnection } from '../../utils/RosbridgeConnection';

export class LayerManager {
  private scene: THREE.Scene;
  private connection: RosbridgeConnection;
  private layers: Map<string, BaseLayer> = new Map();
  private layerConfigs: LayerConfigMap = {};
  private unsubscribeCallbacks: Map<string, () => void> = new Map();
  private topicsChangeUnsubscribe?: () => void;

  constructor(scene: THREE.Scene, connection: RosbridgeConnection) {
    this.scene = scene;
    this.connection = connection;

    this.topicsChangeUnsubscribe = connection.onTopicsChange((topics) => {
      this.handleTopicsChange(topics);
    });
  }

  setLayerConfigs(configs: LayerConfigMap): void {
    this.layerConfigs = configs;
    this.updateLayers();
  }

  getLayerConfigs(): LayerConfigMap {
    return { ...this.layerConfigs };
  }

  updateLayerConfig(layerId: string, config: Partial<LayerConfig>): void {
    if (this.layerConfigs[layerId]) {
      this.layerConfigs[layerId] = { ...this.layerConfigs[layerId]!, ...config };
      this.updateLayers();
    }
  }

  private updateLayers(): void {
    const currentLayerIds = new Set(this.layers.keys());
    const configLayerIds = new Set(Object.keys(this.layerConfigs));

    for (const layerId of currentLayerIds) {
      if (!configLayerIds.has(layerId)) {
        this.removeLayer(layerId);
      }
    }

    for (const [layerId, config] of Object.entries(this.layerConfigs)) {
      if (!this.layers.has(layerId)) {
        this.createLayer(layerId, config);
      } else {
        const layer = this.layers.get(layerId)!;
        layer.setConfig(config);
        if (config.visible && config.enabled) {
          if (config.topic) {
            this.subscribeLayer(layerId, config);
          } else if (layerId === 'grid') {
            this.subscribeGridLayer();
          }
        } else {
          if (layerId !== 'robot') {
            this.unsubscribeLayer(layerId);
          }
          if (!config.visible && layer.getObject3D()) {
            this.scene.remove(layer.getObject3D()!);
          }
        }
      }
    }
  }

  private createLayer(layerId: string, config: LayerConfig): void {
    let layer: BaseLayer;

    switch (config.id) {
      case 'grid':
        layer = new GridLayer(this.scene, config);
        break;
      case 'occupancy_grid':
        layer = new OccupancyGridLayer(this.scene, config);
        break;
      case 'laser_scan':
        layer = new LaserScanLayer(this.scene, config);
        break;
      case 'robot':
        layer = new RobotLayer(this.scene, config);
        break;
      case 'local_plan':
      case 'plan':
        layer = new PathLayer(this.scene, config);
        break;
      case 'footprint':
        layer = new FootprintLayer(this.scene, config);
        break;
      default:
        console.warn(`Unknown layer type: ${config.id}`);
        return;
    }

    this.layers.set(layerId, layer);

    if (config.visible && config.enabled) {
      if (config.topic) {
        this.subscribeLayer(layerId, config);
      } else if (layerId === 'grid') {
        this.subscribeGridLayer();
      }
    }
  }

  private removeLayer(layerId: string): void {
    if (layerId !== 'robot') {
      this.unsubscribeLayer(layerId);
    }
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.dispose();
      this.layers.delete(layerId);
    }
  }

  private subscribeLayer(layerId: string, config: LayerConfig): void {
    if (!config.topic) {
      return;
    }

    this.unsubscribeLayer(layerId);

    const layer = this.layers.get(layerId);
    if (!layer) {
      return;
    }

    const messageType = config.messageType || this.connection.getTopicType(config.topic);
    if (!messageType) {
      console.warn(`No message type found for topic: ${config.topic}`);
      return;
    }

    const callback = (message: unknown) => {
      if (layer.getConfig().enabled && layer.getConfig().visible) {
        layer.update(message);
        const obj3D = layer.getObject3D();
        if (obj3D && !this.scene.children.includes(obj3D)) {
          this.scene.add(obj3D);
        }
      }
    };

    this.connection.subscribe(config.topic, messageType, callback);
    this.unsubscribeCallbacks.set(layerId, () => {
      if (config.topic) {
        this.connection.unsubscribe(config.topic);
      }
    });
  }

  private subscribeGridLayer(): void {
    const gridLayer = this.layers.get('grid');
    if (!gridLayer) {
      return;
    }

    const occupancyConfig = this.layerConfigs['occupancy_grid'];
    if (!occupancyConfig?.topic) {
      return;
    }

    this.unsubscribeLayer('grid');

    const messageType = occupancyConfig.messageType || this.connection.getTopicType(occupancyConfig.topic);
    if (!messageType) {
      return;
    }

    const callback = (message: unknown) => {
      if (gridLayer.getConfig().enabled && gridLayer.getConfig().visible) {
        gridLayer.update(message);
        const obj3D = gridLayer.getObject3D();
        if (obj3D && !this.scene.children.includes(obj3D)) {
          this.scene.add(obj3D);
        }
      }
    };

    this.connection.subscribe(occupancyConfig.topic, messageType, callback);
    this.unsubscribeCallbacks.set('grid', () => {
      if (occupancyConfig.topic) {
        this.connection.unsubscribe(occupancyConfig.topic);
      }
    });
  }

  private unsubscribeLayer(layerId: string): void {
    const unsubscribe = this.unsubscribeCallbacks.get(layerId);
    if (unsubscribe) {
      unsubscribe();
      this.unsubscribeCallbacks.delete(layerId);
    }
  }

  private handleTopicsChange(topics: { name: string; type: string }[]): void {
    const availableTopics = new Set(topics.map((t) => t.name));

    for (const [layerId, config] of Object.entries(this.layerConfigs)) {
      if (config.enabled && config.visible && config.topic) {
        if (availableTopics.has(config.topic)) {
          const topicInfo = topics.find((t) => t.name === config.topic);
          if (topicInfo && topicInfo.type !== config.messageType) {
            this.updateLayerConfig(layerId, { messageType: topicInfo.type });
            this.subscribeLayer(layerId, { ...config, messageType: topicInfo.type });
          } else if (!this.unsubscribeCallbacks.has(layerId)) {
            this.subscribeLayer(layerId, config);
          }
        }
      }
    }
  }

  dispose(): void {
    for (const layerId of this.layers.keys()) {
      this.removeLayer(layerId);
    }
    this.layers.clear();
    this.unsubscribeCallbacks.clear();
    this.topicsChangeUnsubscribe?.();
  }
}

