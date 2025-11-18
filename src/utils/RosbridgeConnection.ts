import * as ROSLIB from 'roslib';
import { parse as parseMessageDefinition } from '@lichtblick/rosmsg';
import { MessageReader as ROS1MessageReader } from '@lichtblick/rosmsg-serialization';
import { MessageReader as ROS2MessageReader } from '@lichtblick/rosmsg2-serialization';
import type { TopicInfo } from '../types/TopicInfo';

export class RosbridgeConnection {
  private ros: ROSLIB.Ros | null = null;
  private subscribers: Map<string, ROSLIB.Topic> = new Map();
  private onMessageCallbacks: Map<string, (message: unknown) => void> = new Map();
  private messageReaders: Map<string, ROS1MessageReader | ROS2MessageReader> = new Map();
  private rosVersion: 1 | 2 = 1;
  private topicsWithTypes: Map<string, string> = new Map();
  private providerTopics: TopicInfo[] = [];
  private topicsChangeCallbacks: Set<(topics: TopicInfo[]) => void> = new Set();
  private topicsCheckInterval?: ReturnType<typeof setInterval>;

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
    }, 3000);
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

  async getTopicsAndRawTypes(): Promise<{
    topics: string[];
    types: string[];
    typedefs_full_text: string[];
  }> {
    if (!this.ros) {
      throw new Error('Not connected to rosbridge');
    }

    return new Promise((resolve, reject) => {
      (this.ros as ROSLIB.Ros).getTopicsAndRawTypes(
        (result: { topics: string[]; types: string[]; typedefs_full_text: string[] }) => {
          resolve(result);
        },
        (error: string) => {
          reject(new Error(error));
        }
      );
    });
  }

  async initializeMessageReaders(): Promise<void> {
    if (!this.ros) {
      throw new Error('Not connected to rosbridge');
    }

    try {
      const result = await this.getTopicsAndRawTypes();

      if (result.types.includes('rcl_interfaces/msg/Log')) {
        this.rosVersion = 2;
      } else if (result.types.includes('rosgraph_msgs/Log')) {
        this.rosVersion = 1;
      } else {
        this.rosVersion = 1;
      }

      this.messageReaders.clear();
      this.topicsWithTypes.clear();
      this.providerTopics = [];

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
          } catch (error) {
            console.error(`Failed to create message reader for ${type}:`, error);
          }
        }
      }
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
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType,
      compression: 'cbor-raw',
    });

    const messageReader = this.messageReaders.get(messageType);

    topic.subscribe((message) => {
      if (messageReader) {
        try {
          const buffer = (message as { bytes: ArrayBuffer }).bytes;
          const bytes = new Uint8Array(buffer);
          const parsedMessage = messageReader.readMessage(bytes);
          callback(parsedMessage);
        } catch (error) {
          console.error(`Failed to parse message on ${topicName}:`, error);
          callback(message);
        }
      } else {
        callback(message);
      }
    });

    this.subscribers.set(topicName, topic);
    this.onMessageCallbacks.set(topicName, callback);
  }

  getTopicType(topicName: string): string | undefined {
    return this.topicsWithTypes.get(topicName);
  }
}

