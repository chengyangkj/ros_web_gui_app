import { useEffect } from 'react';
import { DEFAULT_LAYER_CONFIGS } from '../constants/layerConfigs';
import { loadLayerConfigs, loadImagePositions } from '../utils/layerConfigStorage';

export function useInitialization(
  cmdVelTopicRef: React.MutableRefObject<string>,
  initialposeTopicRef: React.MutableRefObject<string>,
  imagePositionsRef: React.MutableRefObject<Map<string, { x: number; y: number; scale: number }>>
) {
  useEffect(() => {
    const saved = loadLayerConfigs();
    if (saved) {
      const cmdVelConfig = Object.values(saved).find(config => config.id === 'cmd_vel');
      if (cmdVelConfig && cmdVelConfig.topic) {
        cmdVelTopicRef.current = cmdVelConfig.topic as string;
      }
      const initialposeConfig = Object.values(saved).find(config => config.id === 'initialpose');
      if (initialposeConfig && initialposeConfig.topic) {
        initialposeTopicRef.current = initialposeConfig.topic as string;
      }
    }
    const defaultCmdVelConfig = DEFAULT_LAYER_CONFIGS.cmd_vel;
    if (defaultCmdVelConfig && defaultCmdVelConfig.topic) {
      cmdVelTopicRef.current = defaultCmdVelConfig.topic as string;
    }
    const defaultInitialposeConfig = DEFAULT_LAYER_CONFIGS.initialpose;
    if (defaultInitialposeConfig && defaultInitialposeConfig.topic) {
      initialposeTopicRef.current = defaultInitialposeConfig.topic as string;
    }
  }, [cmdVelTopicRef, initialposeTopicRef]);

  useEffect(() => {
    const saved = loadImagePositions();
    if (saved) {
      const map = new Map<string, { x: number; y: number; scale: number }>();
      for (const [layerId, position] of Object.entries(saved)) {
        map.set(layerId, position);
      }
      imagePositionsRef.current = map;
    }
  }, [imagePositionsRef]);
}

