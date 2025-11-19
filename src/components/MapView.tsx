import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toast } from 'react-toastify';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { LayerManager } from './layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';
import { LayerSettingsPanel } from './LayerSettingsPanel';
import { MapEditor } from './MapEditor';
import { loadLayerConfigs, saveLayerConfigs } from '../utils/layerConfigStorage';
import './MapView.css';

interface MapViewProps {
  connection: RosbridgeConnection;
}

const DEFAULT_LAYER_CONFIGS: LayerConfigMap = {
  grid: {
    id: 'grid',
    name: '网格',
    topic: '/map',
    messageType: null,
    enabled: true,
  },
  occupancy_grid: {
    id: 'occupancy_grid',
    name: '栅格地图',
    topic: '/map',
    messageType: 'nav_msgs/OccupancyGrid',
    enabled: true,
    colorMode: 'map',
    height: 0,
  },
  local_costmap: {
    id: 'local_costmap',
    name: '局部代价地图',
    topic: '/local_costmap/costmap',
    messageType: 'nav_msgs/OccupancyGrid',
    enabled: true,
    colorMode: 'costmap',
    alpha: 0.7,
    height: 0.001,
  },
  global_costmap: {
    id: 'global_costmap',
    name: '全局代价地图',
    topic: '/global_costmap/costmap',
    messageType: 'nav_msgs/OccupancyGrid',
    enabled: true,
    colorMode: 'costmap',
    alpha: 0.3,
    height: 0,
  },
  laser_scan: {
    id: 'laser_scan',
    name: '激光雷达',
    topic: '/scan',
    messageType: 'sensor_msgs/LaserScan',
    enabled: true,
    targetFrame: 'map',
  },
  robot: {
    id: 'robot',
    name: '机器人位置',
    topic: null,
    messageType: null,
    enabled: true,
    baseFrame: 'base_center',
    mapFrame: 'map',
  },
  local_plan: {
    id: 'local_plan',
    name: '局部路径',
    topic: '/local_plan',
    messageType: 'nav_msgs/Path',
    enabled: true,
    color: 0x00ff00,
  },
  plan: {
    id: 'plan',
    name: '全局路径',
    topic: '/plan',
    messageType: 'nav_msgs/Path',
    enabled: true,
    color: 0x0000ff,
  },
  footprint: {
    id: 'footprint',
    name: 'Footprint',
    topic: '/local_costmap/published_footprint',
    messageType: 'geometry_msgs/PolygonStamped',
    enabled: true,
  },
  tf: {
    id: 'tf',
    name: 'TF坐标系',
    topic: null,
    messageType: null,
    enabled: true,
    showFrameNames: true,
  },
  topology: {
    id: 'topology',
    name: 'Topology地图',
    topic: '/map/topology',
    messageType: 'topology_msgs/TopologyMap',
    enabled: true,
    color: 0x2196f3,
    pointSize: 0.1,
  },
};

export function MapView({ connection }: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const layerManagerRef = useRef<LayerManager | null>(null);
  const [layerConfigs, setLayerConfigs] = useState<LayerConfigMap>(() => {
    const saved = loadLayerConfigs();
    if (saved) {
      const merged: LayerConfigMap = {};
      for (const [key, defaultConfig] of Object.entries(DEFAULT_LAYER_CONFIGS)) {
        merged[key] = { ...defaultConfig, ...saved[key] };
      }
      return merged;
    }
    return DEFAULT_LAYER_CONFIGS;
  });
  const layerConfigsRef = useRef<LayerConfigMap>(layerConfigs);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const viewModeRef = useRef<'2d' | '3d'>('2d');
  const [showSettings, setShowSettings] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [focusRobot, setFocusRobot] = useState(false);
  const focusRobotRef = useRef(false);
  const followDistanceRef = useRef<number | null>(null);
  const [selectedTopoPoint, setSelectedTopoPoint] = useState<{
    name: string;
    x: number;
    y: number;
    theta: number;
  } | null>(null);
  const [selectedTopoRoute, setSelectedTopoRoute] = useState<{
    from_point: string;
    to_point: string;
    route_info: {
      controller: string;
      goal_checker: string;
      speed_limit: number;
    };
  } | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);
    
    const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    // minDistance 控制最大放大比例（值越小，放大倍数越大）
    // maxDistance 控制最大缩小比例（值越大，缩小倍数越大）
    controls.minDistance = 0.1;
    controls.maxDistance = 1000;
    controls.target.set(0, 0, 0);
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    (controls as any).zoomToCursor = true;
    
    controls.update();
    
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    raycasterRef.current = raycaster;

    const handleClick = (event: MouseEvent) => {
      if (!camera || !scene || !canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj) {
          // 优先检测路线（因为路线在点下方）
          if (obj.userData.isTopoRoute && obj.userData.topoRoute) {
            const route = obj.userData.topoRoute;
            setSelectedTopoRoute({
              from_point: route.from_point,
              to_point: route.to_point,
              route_info: route.route_info,
            });
            setSelectedTopoPoint(null);
            
            // 更新 TopoLayer 的选中状态
            const topoLayer = layerManagerRef.current?.getLayer('topology');
            if (topoLayer && 'setSelectedRoute' in topoLayer) {
              (topoLayer as any).setSelectedRoute(route);
            }
            if (topoLayer && 'setSelectedPoint' in topoLayer) {
              (topoLayer as any).setSelectedPoint(null);
            }
            return;
          }
          if (obj.userData.isTopoPoint && obj.userData.topoPoint) {
            const point = obj.userData.topoPoint;
            setSelectedTopoPoint({
              name: point.name,
              x: point.x,
              y: point.y,
              theta: point.theta,
            });
            setSelectedTopoRoute(null);
            
            // 更新 TopoLayer 的选中状态
            const topoLayer = layerManagerRef.current?.getLayer('topology');
            if (topoLayer && 'setSelectedPoint' in topoLayer) {
              (topoLayer as any).setSelectedPoint(point);
            }
            if (topoLayer && 'setSelectedRoute' in topoLayer) {
              (topoLayer as any).setSelectedRoute(null);
            }
            return;
          }
          obj = obj.parent as THREE.Object3D;
        }
      }
      
      setSelectedTopoPoint(null);
      setSelectedTopoRoute(null);
      
      // 清除 TopoLayer 的选中状态
      const topoLayer = layerManagerRef.current?.getLayer('topology');
      if (topoLayer && 'setSelectedRoute' in topoLayer) {
        (topoLayer as any).setSelectedRoute(null);
      }
      if (topoLayer && 'setSelectedPoint' in topoLayer) {
        (topoLayer as any).setSelectedPoint(null);
      }
    };

    canvas.addEventListener('click', handleClick);


    const layerManager = new LayerManager(scene, connection);
    layerManagerRef.current = layerManager;

    const handleResize = () => {
      if (!camera || !renderer || !canvas.parentElement) return;
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controls && camera) {
        if (focusRobotRef.current) {
          const robotConfig = layerConfigsRef.current.robot;
          if (robotConfig) {
            const baseFrame = (robotConfig as any).baseFrame || 'base_center';
            const mapFrame = (robotConfig as any).mapFrame || 'map';
            const tf2js = TF2JS.getInstance();
            const transform = tf2js.findTransform(mapFrame, baseFrame);
            if (transform) {
              const targetZ = viewModeRef.current === '2d' ? 0 : transform.translation.z;
              controls.target.set(
                transform.translation.x,
                transform.translation.y,
                targetZ
              );
              
              if (followDistanceRef.current === null) {
                const currentDistance = camera.position.distanceTo(controls.target);
                followDistanceRef.current = Math.max(currentDistance, controls.minDistance);
              }
              
              if (viewModeRef.current === '2d') {
                camera.position.set(
                  controls.target.x,
                  controls.target.y,
                  controls.target.z + followDistanceRef.current
                );
                camera.up.set(0, 0, 1);
                camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
              } else {
                const offset = new THREE.Vector3();
                offset.subVectors(camera.position, controls.target);
                const currentDistance = offset.length();
                const targetDistance = followDistanceRef.current;
                
                if (currentDistance > 0.01) {
                  offset.normalize();
                  offset.multiplyScalar(targetDistance);
                  camera.position.copy(controls.target).add(offset);
                } else {
                  camera.position.set(
                    controls.target.x,
                    controls.target.y,
                    controls.target.z + targetDistance
                  );
                }
              }
            }
          }
        } else {
          followDistanceRef.current = null;
        }
        controls.update();
      }
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('click', handleClick);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      layerManager.dispose();
      if (renderer) {
        renderer.dispose();
      }
    };
  }, [connection]);

  useEffect(() => {
    if (!connection.isConnected() || !layerManagerRef.current) {
      return;
    }

    const initializeAndSubscribe = async () => {
      try {
        await connection.initializeMessageReaders();
        
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(layerConfigs);
      } catch (error) {
        console.error('Failed to initialize message readers:', error);
        toast.error('初始化失败，使用默认配置...');
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(layerConfigs);
      }
    };

    void initializeAndSubscribe();

    return () => {
      TF2JS.getInstance().disconnect();
    };
  }, [connection]);

  useEffect(() => {
    layerConfigsRef.current = layerConfigs;
  }, [layerConfigs]);

  useEffect(() => {
    if (layerManagerRef.current && connection.isConnected()) {
      layerManagerRef.current.setLayerConfigs(layerConfigs);
    }
  }, [layerConfigs, connection]);

  const handleConfigChange = (layerId: string, config: Partial<import('../types/LayerConfig').LayerConfig>) => {
    setLayerConfigs((prev) => {
      const updated = { ...prev };
      if (updated[layerId]) {
        updated[layerId] = { ...updated[layerId]!, ...config };
      }
      saveLayerConfigs(updated);
      return updated;
    });
  };

  useEffect(() => {
    focusRobotRef.current = focusRobot;
  }, [focusRobot]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    
    if (!controlsRef.current || !cameraRef.current) {
      return;
    }

    const controls = controlsRef.current;
    const camera = cameraRef.current;

    if (viewMode === '2d') {
      controls.enableRotate = false;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.enableDamping = true;
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      (controls as any).zoomToCursor = true;
      
      const targetZ = 0;
      // 使用 controls.minDistance 来限制最小距离，而不是硬编码 0.1
      const distance = Math.max(Math.abs(camera.position.z - targetZ), controls.minDistance);
      camera.up.set(0, 0, 1);
      camera.position.set(controls.target.x, controls.target.y, targetZ + distance);
      controls.target.set(controls.target.x, controls.target.y, targetZ);
      camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
      
      controls.update();
      

    } else {
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.screenSpacePanning = false;
      controls.maxPolarAngle = Math.PI;
      controls.minPolarAngle = 0;
      controls.enableDamping = true;
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      (controls as any).zoomToCursor = true;
      camera.up.set(0, 0, 1);
      controls.update();
    }
  }, [viewMode]);

  const handleViewModeToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setViewMode((prev) => {
      const newMode = prev === '2d' ? '3d' : '2d';
      viewModeRef.current = newMode;
      console.log(`切换视图模式: ${prev} -> ${newMode}`);
      return newMode;
    });
  };

  const handleFocusRobotToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setFocusRobot((prev) => {
      if (!prev && controlsRef.current && cameraRef.current) {
        const controls = controlsRef.current;
        const camera = cameraRef.current;
        const currentDistance = camera.position.distanceTo(controls.target);
        followDistanceRef.current = Math.max(currentDistance, controls.minDistance);
      } else if (!prev) {
        followDistanceRef.current = 10;
      }
      return !prev;
    });
  };

  const handleNavigateToPoint = () => {
    if (!selectedTopoPoint || !connection.isConnected()) {
      return;
    }

    const quaternion = new THREE.Quaternion();
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), selectedTopoPoint.theta);

    const message = {
      header: {
        stamp: {
          sec: Math.floor(Date.now() / 1000),
          nanosec: (Date.now() % 1000) * 1000000,
        },
        frame_id: 'map',
      },
      pose: {
        position: {
          x: selectedTopoPoint.x,
          y: selectedTopoPoint.y,
          z: 0,
        },
        orientation: {
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
          w: quaternion.w,
        },
      },
    };

    connection.publish('/goal_pose', 'geometry_msgs/msg/PoseStamped', message);
    toast.success(`已发布导航目标: ${selectedTopoPoint.name}`);
  };

  return (
    <div className="MapView">
      <div className="ViewControls">
        <button
          className={`ViewButton ${viewMode === '2d' ? 'active' : ''}`}
          onClick={handleViewModeToggle}
          title={`当前: ${viewMode === '2d' ? '2D' : '3D'}视图，点击切换到${viewMode === '2d' ? '3D' : '2D'}`}
          type="button"
        >
          {viewMode === '2d' ? '2D' : '3D'}
        </button>
        <button
          className="SettingsButton"
          onClick={() => setShowSettings(!showSettings)}
          title="图层配置"
          type="button"
        >
          ⚙
        </button>
        <button
          className="SettingsButton"
          onClick={() => setShowEditor(true)}
          title="地图编辑"
          type="button"
        >
          ✏️
        </button>
      </div>
      <div className="BottomControls">
        <button
          className={`FocusRobotButton ${focusRobot ? 'active' : ''}`}
          onClick={handleFocusRobotToggle}
          title={focusRobot ? '取消跟随机器人' : '跟随机器人'}
          type="button"
        >
          {focusRobot ? '📍 跟随中' : '📍 跟随机器人'}
        </button>
      </div>
      {showSettings && (
        <LayerSettingsPanel
          layerConfigs={layerConfigs}
          onConfigChange={handleConfigChange}
          onResetToDefaults={() => {
            setLayerConfigs(DEFAULT_LAYER_CONFIGS);
            saveLayerConfigs(DEFAULT_LAYER_CONFIGS);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showEditor && (
        <MapEditor
          connection={connection}
          onClose={() => setShowEditor(false)}
        />
      )}
      {selectedTopoPoint && (
        <div className="TopoPointInfoPanel">
          <div className="TopoPointInfoHeader">
            <h3>导航点信息</h3>
            <button
              className="CloseButton"
              onClick={() => {
                setSelectedTopoPoint(null);
                const topoLayer = layerManagerRef.current?.getLayer('topology');
                if (topoLayer && 'setSelectedPoint' in topoLayer) {
                  (topoLayer as any).setSelectedPoint(null);
                }
                if (topoLayer && 'setSelectedRoute' in topoLayer) {
                  (topoLayer as any).setSelectedRoute(null);
                }
              }}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="TopoPointInfoContent">
            <div className="InfoRow">
              <span className="InfoLabel">名称:</span>
              <span className="InfoValue">{selectedTopoPoint.name}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">X:</span>
              <span className="InfoValue">{selectedTopoPoint.x.toFixed(3)}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">Y:</span>
              <span className="InfoValue">{selectedTopoPoint.y.toFixed(3)}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">Theta:</span>
              <span className="InfoValue">{selectedTopoPoint.theta.toFixed(3)}</span>
            </div>
            <button
              className="NavigateButton"
              onClick={handleNavigateToPoint}
              type="button"
            >
              单点导航
            </button>
          </div>
        </div>
      )}
      {selectedTopoRoute && (
        <div className="TopoPointInfoPanel">
          <div className="TopoPointInfoHeader">
            <h3>路线信息</h3>
            <button
              className="CloseButton"
              onClick={() => {
                setSelectedTopoRoute(null);
                const topoLayer = layerManagerRef.current?.getLayer('topology');
                if (topoLayer && 'setSelectedRoute' in topoLayer) {
                  (topoLayer as any).setSelectedRoute(null);
                }
                if (topoLayer && 'setSelectedPoint' in topoLayer) {
                  (topoLayer as any).setSelectedPoint(null);
                }
              }}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="TopoPointInfoContent">
            <div className="InfoRow">
              <span className="InfoLabel">起点:</span>
              <span className="InfoValue">{selectedTopoRoute.from_point}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">终点:</span>
              <span className="InfoValue">{selectedTopoRoute.to_point}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">控制器:</span>
              <span className="InfoValue">{selectedTopoRoute.route_info.controller || '-'}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">目标检查器:</span>
              <span className="InfoValue">{selectedTopoRoute.route_info.goal_checker || '-'}</span>
            </div>
            <div className="InfoRow">
              <span className="InfoLabel">速度限制:</span>
              <span className="InfoValue">{selectedTopoRoute.route_info.speed_limit.toFixed(2)} m/s</span>
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="MapCanvas" />
    </div>
  );
}
