import * as ROSLIB from 'roslib';
import { parse as parseMessageDefinition } from '@lichtblick/rosmsg';
import { MessageReader as ROS1MessageReader } from '@lichtblick/rosmsg-serialization';
import { MessageReader as ROS2MessageReader } from '@lichtblick/rosmsg2-serialization';
import type { TopicInfo } from '../types/TopicInfo';

export class RosbridgeConnection {
  private ros: ROSLIB.Ros | null = null;
  private subscribers: Map<string, ROSLIB.Topic> = new Map();
  private publishers: Map<string, ROSLIB.Topic> = new Map();
  private onMessageCallbacks: Map<string, (message: unknown) => void> = new Map();
  private messageReaders: Map<string, ROS1MessageReader | ROS2MessageReader> = new Map();
  private rosVersion: 1 | 2 = 1;
  private topicsWithTypes: Map<string, string> = new Map();
  private providerTopics: TopicInfo[] = [];
  private topicsChangeCallbacks: Set<(topics: TopicInfo[]) => void> = new Set();
  private topicsCheckInterval?: ReturnType<typeof setInterval>;
  private topicsAndRawTypesCache?: {
    topics: string[];
    types: string[];
    typedefs_full_text: string[];
    timestamp: number;
  };

  async connect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ros = new ROSLIB.Ros({ url });

        this.ros.on('connection', () => {
          console.log('Connected to rosbridge');
          this.startTopicsMonitoring();
          resolve(true);
        });

        this.ros.on('error', (error) => {
          console.error('Rosbridge error:', error);
          this.stopTopicsMonitoring();
          resolve(false);
        });

        this.ros.on('close', () => {
          console.log('Rosbridge connection closed');
          this.stopTopicsMonitoring();
        });
      } catch (error) {
        console.error('Failed to create rosbridge connection:', error);
        resolve(false);
      }
    });
  }

  private startTopicsMonitoring(): void {
    if (this.topicsCheckInterval) {
      return;
    }

    this.topicsCheckInterval = setInterval(() => {
      void this.checkTopicsChanged();
    }, 15000);
  }

  private stopTopicsMonitoring(): void {
    if (this.topicsCheckInterval) {
      clearInterval(this.topicsCheckInterval);
      this.topicsCheckInterval = undefined;
    }
  }

  private topicsChanged(newTopics: TopicInfo[]): boolean {
    if (this.providerTopics.length !== newTopics.length) {
      return true;
    }

    const sortedNew = [...newTopics].sort((a, b) => a.name.localeCompare(b.name));
    const sortedOld = [...this.providerTopics].sort((a, b) => a.name.localeCompare(b.name));

    if (sortedNew.length !== sortedOld.length) {
      return true;
    }

    for (let i = 0; i < sortedNew.length; i++) {
      if (sortedNew[i]!.name !== sortedOld[i]!.name || sortedNew[i]!.type !== sortedOld[i]!.type) {
        return true;
      }
    }

    return false;
  }

  private async checkTopicsChanged(): Promise<void> {
    if (!this.ros || !this.ros.isConnected) {
      return;
    }

    try {
      const result = await this.getTopicsAndRawTypes();
      const topics: TopicInfo[] = [];

      for (let i = 0; i < result.topics.length; i++) {
        const topicName = result.topics[i]!;
        const type = result.types[i];
        if (type) {
          topics.push({ name: topicName, type });
        }
      }

      if (this.topicsChanged(topics)) {
        this.providerTopics = topics;
        this.topicsWithTypes.clear();
        topics.forEach((topic) => {
          this.topicsWithTypes.set(topic.name, topic.type);
        });

        this.topicsChangeCallbacks.forEach((callback) => {
          callback(topics);
        });
      }
    } catch (error) {
      console.error('Failed to check topics:', error);
    }
  }

  onTopicsChange(callback: (topics: TopicInfo[]) => void): () => void {
    this.topicsChangeCallbacks.add(callback);
    return () => {
      this.topicsChangeCallbacks.delete(callback);
    };
  }

  getProviderTopics(): TopicInfo[] {
    return [...this.providerTopics];
  }

  disconnect(): void {
    this.stopTopicsMonitoring();
    this.subscribers.forEach((topic) => {
      topic.unsubscribe();
    });
    this.subscribers.clear();
    this.publishers.forEach((topic) => {
      topic.unadvertise();
    });
    this.publishers.clear();
    this.onMessageCallbacks.clear();
    this.messageReaders.clear();
    this.topicsWithTypes.clear();
    this.providerTopics = [];
    this.topicsChangeCallbacks.clear();

    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }
  }

  unsubscribe(topicName: string): void {
    const topic = this.subscribers.get(topicName);
    if (topic) {
      topic.unsubscribe();
      this.subscribers.delete(topicName);
      this.onMessageCallbacks.delete(topicName);
    }
  }

  isConnected(): boolean {
    return this.ros?.isConnected ?? false;
  }

  getTopics(callback: (topics: string[]) => void, errorCallback?: (error: Error) => void): void {
    if (!this.ros) {
      errorCallback?.(new Error('Not connected to rosbridge'));
      return;
    }

    this.ros.getTopics((result: { topics: string[]; types: string[] }) => {
      callback(result.topics);
    }, (error: string) => {
      errorCallback?.(new Error(error));
    });
  }

  async getTopicsAndRawTypes(useCache: boolean = true): Promise<{
    topics: string[];
    types: string[];
    typedefs_full_text: string[];
  }> {
    if (!this.ros) {
      throw new Error('Not connected to rosbridge');
    }

    const CACHE_DURATION = 5000;
    const now = Date.now();
    
    if (useCache && this.topicsAndRawTypesCache) {
      const age = now - this.topicsAndRawTypesCache.timestamp;
      if (age < CACHE_DURATION) {
        return this.topicsAndRawTypesCache;
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.topicsAndRawTypesCache) {
          console.warn('[RosbridgeConnection] getTopicsAndRawTypes timeout, using cached data');
          resolve(this.topicsAndRawTypesCache);
        } else {
          console.error('[RosbridgeConnection] getTopicsAndRawTypes timeout after 10 seconds');
          reject(new Error('getTopicsAndRawTypes timeout'));
        }
      }, 10000);

      (this.ros as ROSLIB.Ros).getTopicsAndRawTypes(
        (result: { topics: string[]; types: string[]; typedefs_full_text: string[] }) => {
          clearTimeout(timeout);
          this.topicsAndRawTypesCache = {
            ...result,
            timestamp: now
          };
          resolve(result);
        },
        (error: string) => {
          clearTimeout(timeout);
          if (this.topicsAndRawTypesCache) {
            console.warn('[RosbridgeConnection] getTopicsAndRawTypes error, using cached data:', error);
            resolve(this.topicsAndRawTypesCache);
          } else {
            console.error('[RosbridgeConnection] getTopicsAndRawTypes error:', error);
            reject(new Error(error));
          }
        }
      );
    });
  }

  async initializeMessageReaders(): Promise<void> {
    if (!this.ros) {
      throw new Error('Not connected to rosbridge');
    }

    try {
      console.log('[RosbridgeConnection] initializeMessageReaders: calling getTopicsAndRawTypes...');
      const result = await this.getTopicsAndRawTypes();
      console.log('[RosbridgeConnection] getTopicsAndRawTypes result:', {
        topicsCount: result.topics.length,
        typesCount: result.types.length,
        topics: result.topics.slice(0, 10),
        types: result.types.slice(0, 10)
      });

      if (result.types.includes('rcl_interfaces/msg/Log')) {
        this.rosVersion = 2;
      } else if (result.types.includes('rosgraph_msgs/Log')) {
        this.rosVersion = 1;
      } else {
        this.rosVersion = 1;
      }
      console.log('[RosbridgeConnection] Detected ROS version:', this.rosVersion);

      this.messageReaders.clear();
      this.topicsWithTypes.clear();
      this.providerTopics = [];

      let createdCount = 0;
      for (let i = 0; i < result.topics.length; i++) {
        const topicName = result.topics[i]!;
        const type = result.types[i];
        const messageDefinition = result.typedefs_full_text[i];

        if (!type || !messageDefinition) {
          continue;
        }

        this.topicsWithTypes.set(topicName, type);
        this.providerTopics.push({ name: topicName, type });

        if (!this.messageReaders.has(type)) {
          try {
            const parsedDefinition = parseMessageDefinition(messageDefinition, {
              ros2: this.rosVersion === 2,
            });
            const reader =
              this.rosVersion !== 2
                ? new ROS1MessageReader(parsedDefinition)
                : new ROS2MessageReader(parsedDefinition);
            this.messageReaders.set(type, reader);
            
            if (this.rosVersion === 2 && type.includes('/msg/')) {
              const ros1Type = type.replace('/msg/', '/');
              if (!this.messageReaders.has(ros1Type)) {
                this.messageReaders.set(ros1Type, reader);
              }
            } else if (this.rosVersion === 1 && !type.includes('/msg/')) {
              const ros2Type = type.replace('/', '/msg/');
              if (!this.messageReaders.has(ros2Type)) {
                this.messageReaders.set(ros2Type, reader);
              }
            }
            
            createdCount++;
          } catch (error) {
            console.error(`Failed to create message reader for ${type}:`, error);
          }
        }
      }
      console.log(`[RosbridgeConnection] initializeMessageReaders completed: created ${createdCount} readers, total: ${this.messageReaders.size}`);
    } catch (error) {
      console.error('Failed to initialize message readers:', error);
      throw error;
    }
  }

  subscribe(
    topicName: string,
    messageType: string,
    callback: (message: unknown) => void
  ): void {
    if (!this.ros) {
      console.error('Not connected to rosbridge');
      return;
    }

    if (this.subscribers.has(topicName)) {
      this.subscribers.get(topicName)?.unsubscribe();
      console.warn(`[RosbridgeConnection] subscribe ${topicName} already subscribed, unsubscribing...`);
    }

    let actualMessageType = messageType;
    
    const topicType = this.topicsWithTypes.get(topicName);
    if (topicType) {
      actualMessageType = topicType;
    } else {
      if (this.rosVersion === 2 && !messageType.includes('/msg/')) {
        actualMessageType = messageType.replace('/', '/msg/');
      } else if (this.rosVersion === 1 && messageType.includes('/msg/')) {
        actualMessageType = messageType.replace('/msg/', '/');
      }
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: actualMessageType,
      compression: 'cbor-raw',
    });

    const messageReader = this.messageReaders.get(actualMessageType) || this.messageReaders.get(messageType);
    
    console.log(`[RosbridgeConnection] subscribe ${topicName}:`, {
      requestedType: messageType,
      actualType: actualMessageType,
      hasMessageReader: !!messageReader,
      rosVersion: this.rosVersion
    });

    topic.subscribe((message) => {
      const currentReader = this.messageReaders.get(actualMessageType) || this.messageReaders.get(messageType);
      if (currentReader) {
        try {
          const buffer = (message as { bytes: ArrayBuffer }).bytes;
          const bytes = new Uint8Array(buffer);
          const parsedMessage = currentReader.readMessage(bytes);
          callback(parsedMessage);
        } catch (error) {
          console.error(`[RosbridgeConnection] Failed to parse message on ${topicName}:`, {
            error,
            messageType: actualMessageType,
            requestedType: messageType,
            messageKeys: Object.keys(message || {}),
            hasBytes: !!(message as any)?.bytes,
            bytesLength: (message as any)?.bytes?.length
          });
          callback(message);
        }
      } else {
        console.warn(`[RosbridgeConnection] No MessageReader found for ${topicName}`, {
          actualType: actualMessageType,
          requestedType: messageType,
          availableReaders: Array.from(this.messageReaders.keys()),
          messageKeys: Object.keys(message || {})
        });
        callback(message);
      }
    });

    this.subscribers.set(topicName, topic);
    this.onMessageCallbacks.set(topicName, callback);
  }

  getTopicType(topicName: string): string | undefined {
    return this.topicsWithTypes.get(topicName);
  }

  publish(topicName: string, messageType: string, message: unknown): void {
    if (!this.ros || !this.ros.isConnected) {
      const error = new Error('Not connected to rosbridge');
      console.error('[RosbridgeConnection] publish failed:', error.message, { topicName, messageType });
      throw error;
    }

    let actualMessageType = messageType;
    const topicType = this.topicsWithTypes.get(topicName);
    if (topicType) {
      actualMessageType = topicType;
    } else {
      if (this.rosVersion === 2 && !messageType.includes('/msg/')) {
        actualMessageType = messageType.replace('/', '/msg/');
      } else if (this.rosVersion === 1 && messageType.includes('/msg/')) {
        actualMessageType = messageType.replace('/msg/', '/');
      }
    }

    try {
      let topic = this.publishers.get(topicName);
      if (!topic) {
        topic = new ROSLIB.Topic({
          ros: this.ros,
          name: topicName,
          messageType: actualMessageType,
        });
        topic.advertise();
        this.publishers.set(topicName, topic);
        console.log('[RosbridgeConnection] Created and advertised publisher for topic', { topicName, messageType: actualMessageType });
      }
      
      const messageStr = JSON.stringify(message, null, 2);
      console.log('[RosbridgeConnection] Publishing message', { 
        topicName, 
        messageType: actualMessageType,
        hasMessage: !!message,
        messageKeys: message && typeof message === 'object' ? Object.keys(message) : [],
        messagePreview: messageStr.substring(0, 500)
      });
      
      topic.publish(message as ROSLIB.Message);
      
      console.log('[RosbridgeConnection] Message published successfully', { 
        topicName,
        messageType: actualMessageType,
        rosConnected: this.ros?.isConnected
      });
    } catch (error) {
      console.error('[RosbridgeConnection] Failed to publish message:', error, { 
        topicName, 
        messageType: actualMessageType,
        rosConnected: this.ros?.isConnected,
        errorDetails: error instanceof Error ? error.message : String(error)
      });
      this.publishers.delete(topicName);
      throw error;
    }
  }

}

