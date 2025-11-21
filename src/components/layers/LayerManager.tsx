import * as THREE from 'three';
import { BaseLayer } from './BaseLayer';
import { GridLayer } from './GridLayer';
import { OccupancyGridLayer } from './OccupancyGridLayer';
import { LaserScanLayer } from './LaserScanLayer';
import { RobotLayer } from './RobotLayer';
import { PathLayer } from './PathLayer';
import { FootprintLayer } from './FootprintLayer';
import { TFLayer } from './TFLayer';
import { TopoLayer } from './TopoLayer';
import type { LayerConfig, LayerConfigMap } from '../../types/LayerConfig';
import { RosbridgeConnection } from '../../utils/RosbridgeConnection';

export class LayerManager {
  private scene: THREE.Scene;
  private connection: RosbridgeConnection;
  private layers: Map<string, BaseLayer> = new Map();
  private layerConfigs: LayerConfigMap = {};

  constructor(scene: THREE.Scene, connection: RosbridgeConnection) {
    this.scene = scene;
    this.connection = connection;
  }

  setLayerConfigs(configs: LayerConfigMap): void {
    console.log('[LayerManager] setLayerConfigs called:', Object.keys(configs), 'connection connected:', this.connection.isConnected());
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

    console.log('[LayerManager] updateLayers:', { 
      currentLayers: Array.from(currentLayerIds), 
      configLayers: Array.from(configLayerIds),
      connectionConnected: this.connection.isConnected()
    });

    for (const layerId of currentLayerIds) {
      if (!configLayerIds.has(layerId)) {
        console.log('[LayerManager] Removing layer:', layerId);
        this.removeLayer(layerId);
      }
    }

    for (const [layerId, config] of Object.entries(this.layerConfigs)) {
      if (!this.layers.has(layerId)) {
        console.log('[LayerManager] Creating new layer:', layerId, config);
        this.createLayer(layerId, config);
      } else {
        const layer = this.layers.get(layerId)!;
        const oldConnection = layer.connection;
        if (oldConnection !== this.connection) {
          console.log('[LayerManager] Updating connection for layer:', layerId);
          layer.setConnection(this.connection);
        }
        console.log('[LayerManager] Updating config for layer:', layerId);
        layer.setConfig(config);
      }
    }
  }

  private createLayer(layerId: string, config: LayerConfig): void {
    console.log('[LayerManager] createLayer:', layerId, config.id, 'connection connected:', this.connection.isConnected());
    let layer: BaseLayer;

    switch (config.id) {
      case 'grid':
        layer = new GridLayer(this.scene, config, this.connection);
        break;
      case 'occupancy_grid':
      case 'local_costmap':
      case 'global_costmap':
        layer = new OccupancyGridLayer(this.scene, config, this.connection);
        break;
      case 'laser_scan':
        layer = new LaserScanLayer(this.scene, config, this.connection);
        break;
      case 'robot':
        layer = new RobotLayer(this.scene, config, this.connection);
        break;
      case 'local_plan':
      case 'plan':
        layer = new PathLayer(this.scene, config, this.connection);
        break;
      case 'footprint':
        layer = new FootprintLayer(this.scene, config, this.connection);
        break;
      case 'tf':
        layer = new TFLayer(this.scene, config, this.connection);
        break;
      case 'topology':
        layer = new TopoLayer(this.scene, config, this.connection);
        break;
      default:
        console.warn(`Unknown layer type: ${config.id}`);
        return;
    }

    this.layers.set(layerId, layer);
    console.log('[LayerManager] Layer created:', layerId, 'has object3D:', !!layer.getObject3D());
  }

  private removeLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.dispose();
      this.layers.delete(layerId);
    }
  }

  getLayer(layerId: string): BaseLayer | undefined {
    return this.layers.get(layerId);
  }

  dispose(): void {
    for (const layerId of this.layers.keys()) {
      this.removeLayer(layerId);
    }
    this.layers.clear();
  }
}

