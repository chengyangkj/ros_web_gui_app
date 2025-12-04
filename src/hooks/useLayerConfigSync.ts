import { useEffect } from 'react';
import type { LayerConfigMap } from '../types/LayerConfig';
import type { LayerManager } from '../components/layers/LayerManager';
import type { RosbridgeConnection } from '../utils/RosbridgeConnection';

export function useLayerConfigSync(
  layerConfigs: LayerConfigMap,
  layerConfigsRef: React.MutableRefObject<LayerConfigMap>,
  layerManagerRef: React.MutableRefObject<LayerManager | null>,
  connection: RosbridgeConnection,
  cmdVelTopicRef: React.MutableRefObject<string>,
  initialposeTopicRef: React.MutableRefObject<string>
) {
  useEffect(() => {
    layerConfigsRef.current = layerConfigs;
    const cmdVelConfig = Object.values(layerConfigs).find(config => config.id === 'cmd_vel');
    if (cmdVelConfig && cmdVelConfig.topic) {
      cmdVelTopicRef.current = cmdVelConfig.topic as string;
    }
    const initialposeConfig = Object.values(layerConfigs).find(config => config.id === 'initialpose');
    if (initialposeConfig && initialposeConfig.topic) {
      initialposeTopicRef.current = initialposeConfig.topic as string;
    }
  }, [layerConfigs, layerConfigsRef, cmdVelTopicRef, initialposeTopicRef]);

  useEffect(() => {
    if (layerManagerRef.current && connection.isConnected()) {
      layerManagerRef.current.setLayerConfigs(layerConfigs);
    }
  }, [layerConfigs, connection, layerManagerRef]);
}

