import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import type { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { MapManager } from '../utils/MapManager';
import type { LayerManager } from '../components/layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';

export function useConnectionInit(
  connection: RosbridgeConnection,
  layerManagerRef: React.MutableRefObject<LayerManager | null>,
  layerConfigs: LayerConfigMap
) {
  useEffect(() => {
    if (!connection.isConnected() || !layerManagerRef.current) {
      return;
    }

    const initializeAndSubscribe = async () => {
      try {
        await connection.initializeMessageReaders();
        
        console.log('[MapView] Initializing MapManager after MessageReaders are ready', { 
          hasConnection: !!connection, 
          isConnected: connection.isConnected() 
        });
        const mapManager = MapManager.getInstance();
        mapManager.initialize(connection);
        
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(layerConfigs);
      } catch (error) {
        console.error('Failed to initialize message readers:', error);
        toast.error('初始化失败，使用默认配置...');
        const mapManager = MapManager.getInstance();
        mapManager.initialize(connection);
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(layerConfigs);
      }
    };

    void initializeAndSubscribe();

    return () => {
      TF2JS.getInstance().disconnect();
    };
  }, [connection, layerManagerRef, layerConfigs]);
}

