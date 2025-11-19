import * as THREE from 'three';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';

export interface LayerRenderable {
  dispose(): void;
  update(message: unknown): void;
  getObject3D(): THREE.Object3D | null;
}

export abstract class BaseLayer implements LayerRenderable {
  protected scene: THREE.Scene;
  protected config: LayerConfig;
  protected connection: RosbridgeConnection | null = null;
  protected object3D: THREE.Object3D | null = null;
  private unsubscribeCallback: (() => void) | null = null;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    this.scene = scene;
    this.config = config;
    this.connection = connection;
  }

  abstract getMessageType(): string | null;

  protected subscribe(topic: string | null, messageType: string | null): void {
    console.log(`[${this.constructor.name}] subscribe called:`, { topic, messageType, hasConnection: !!this.connection });
    
    if (!topic || !messageType || !this.connection) {
      console.log(`[${this.constructor.name}] subscribe skipped:`, { topic: !!topic, messageType: !!messageType, hasConnection: !!this.connection });
      return;
    }

    if (!this.connection.isConnected()) {
      console.log(`[${this.constructor.name}] subscribe skipped: connection not connected`);
      return;
    }

    this.unsubscribe();

    const finalMessageType = messageType || this.connection.getTopicType(topic);
    if (!finalMessageType) {
      console.warn(`[${this.constructor.name}] No message type found for topic: ${topic}`);
      return;
    }

    console.log(`[${this.constructor.name}] Subscribing to topic: ${topic}, messageType: ${finalMessageType}`);

    const callback = (message: unknown) => {
      if (this.config.enabled) {
        this.update(message);
        const obj3D = this.getObject3D();
        if (obj3D && !this.scene.children.includes(obj3D)) {
          this.scene.add(obj3D);
        }
      }
    };

    this.connection.subscribe(topic, finalMessageType, callback);
    this.unsubscribeCallback = () => {
      this.connection?.unsubscribe(topic);
    };
    
    console.log(`[${this.constructor.name}] Successfully subscribed to: ${topic}`);
  }

  protected unsubscribe(): void {
    if (this.unsubscribeCallback) {
      this.unsubscribeCallback();
      this.unsubscribeCallback = null;
    }
  }

  abstract update(message: unknown): void;

  getObject3D(): THREE.Object3D | null {
    return this.object3D;
  }

  protected disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  setConfig(config: LayerConfig): void {
    const oldTopic = this.config.topic;
    console.log(`[${this.constructor.name}] setConfig:`, { oldTopic, newTopic: config.topic, enabled: config.enabled });
    this.config = config;
    
    if (config.topic !== oldTopic && this.connection?.isConnected()) {
      console.log(`[${this.constructor.name}] Topic changed, resubscribing...`);
      this.subscribe(config.topic, this.getMessageType());
    }
    
    if (!config.enabled && this.object3D) {
      this.scene.remove(this.object3D);
    } else if (config.enabled && this.object3D && !this.scene.children.includes(this.object3D)) {
      this.scene.add(this.object3D);
    }
  }

  getConfig(): LayerConfig {
    return this.config;
  }

  setConnection(connection: RosbridgeConnection): void {
    console.log(`[${this.constructor.name}] setConnection:`, { 
      isConnected: connection.isConnected(), 
      topic: this.config.topic,
      enabled: this.config.enabled
    });
    this.connection = connection;
    if (this.config.topic && connection.isConnected()) {
      console.log(`[${this.constructor.name}] Connection set and connected, subscribing...`);
      this.subscribe(this.config.topic, this.getMessageType());
    } else {
      console.log(`[${this.constructor.name}] Connection set but not subscribing:`, {
        hasTopic: !!this.config.topic,
        isConnected: connection.isConnected()
      });
    }
  }

  dispose(): void {
    this.unsubscribe();
    if (this.object3D) {
      this.scene.remove(this.object3D);
      this.disposeObject3D(this.object3D);
      this.object3D = null;
    }
  }
}
