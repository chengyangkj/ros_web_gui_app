import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toast } from 'react-toastify';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { MapManager } from '../utils/MapManager';
import { LayerManager } from './layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';
import { LayerSettingsPanel } from './LayerSettingsPanel';
import { MapEditor } from './MapEditor';
import { loadLayerConfigs, saveLayerConfigs, loadImagePositions, saveImagePositions, type ImagePositionsMap } from '../utils/layerConfigStorage';
import type { ImageLayerData } from './layers/ImageLayer';
import './MapView.css';

interface MapViewProps {
  connection: RosbridgeConnection;
}

interface ImageDisplayProps {
  imageData: ImageLayerData;
  name: string;
  position: { x: number; y: number; scale: number };
  onPositionChange: (position: { x: number; y: number; scale: number }) => void;
}

function ImageDisplay({ imageData, name, position, onPositionChange }: ImageDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{ x: number; y: number; scale: number; initialDistance?: number } | null>(null);

  const handleMouseMove = useRef((e: MouseEvent) => {
    if (isDraggingRef.current && dragStartRef.current) {
      onPositionChange({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
        scale: position.scale,
      });
    } else if (isResizingRef.current && resizeStartRef.current) {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        const currentDistance = Math.sqrt(
          Math.pow(containerRect.right - e.clientX, 2) + 
          Math.pow(containerRect.bottom - e.clientY, 2)
        );
        const initialDistance = resizeStartRef.current.initialDistance || 100;
        const scaleRatio = currentDistance / initialDistance;
        const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale * scaleRatio));
        onPositionChange({
          x: position.x,
          y: position.y,
          scale: newScale,
        });
        resizeStartRef.current.initialDistance = currentDistance / (newScale / resizeStartRef.current.scale);
      } else {
        const deltaX = e.clientX - resizeStartRef.current.x;
        const deltaY = e.clientY - resizeStartRef.current.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const direction = deltaX + deltaY > 0 ? 1 : -1;
        const scaleDelta = (distance * direction) / 200;
        const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale + scaleDelta));
        onPositionChange({
          x: position.x,
          y: position.y,
          scale: newScale,
        });
      }
    }
  });

  const handleMouseUp = useRef(() => {
    isDraggingRef.current = false;
    isResizingRef.current = false;
    dragStartRef.current = null;
    resizeStartRef.current = null;
  });

  useEffect(() => {
    handleMouseMove.current = (e: MouseEvent) => {
      if (isDraggingRef.current && dragStartRef.current) {
        onPositionChange({
          x: e.clientX - dragStartRef.current.x,
          y: e.clientY - dragStartRef.current.y,
          scale: position.scale,
        });
      } else if (isResizingRef.current && resizeStartRef.current) {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const currentDistance = Math.sqrt(
            Math.pow(containerRect.right - e.clientX, 2) + 
            Math.pow(containerRect.bottom - e.clientY, 2)
          );
          const initialDistance = resizeStartRef.current.initialDistance || 100;
          const scaleRatio = currentDistance / initialDistance;
          const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale * scaleRatio));
          onPositionChange({
            x: position.x,
            y: position.y,
            scale: newScale,
          });
          resizeStartRef.current.initialDistance = currentDistance / (newScale / resizeStartRef.current.scale);
        } else {
          const deltaX = e.clientX - resizeStartRef.current.x;
          const deltaY = e.clientY - resizeStartRef.current.y;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const direction = deltaX + deltaY > 0 ? 1 : -1;
          const scaleDelta = (distance * direction) / 200;
          const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale + scaleDelta));
          onPositionChange({
            x: position.x,
            y: position.y,
            scale: newScale,
          });
        }
      }
    };
    handleMouseUp.current = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };
  }, [position, onPositionChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target === containerRef.current || target.classList.contains('ImageDisplay') || target.closest('.ImageDisplay') === containerRef.current) {
      if (target.closest('.ImageResizeHandle')) {
        return;
      }
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      
      const handleMouseMoveGlobal = (e: MouseEvent) => {
        handleMouseMove.current(e);
      };
      const handleMouseUpGlobal = () => {
        handleMouseUp.current();
        window.removeEventListener('mousemove', handleMouseMoveGlobal);
        window.removeEventListener('mouseup', handleMouseUpGlobal);
      };
      
      window.addEventListener('mousemove', handleMouseMoveGlobal);
      window.addEventListener('mouseup', handleMouseUpGlobal);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(5, position.scale + delta));
    onPositionChange({
      x: position.x,
      y: position.y,
      scale: newScale,
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isResizingRef.current = true;
    const containerRect = containerRef.current?.getBoundingClientRect();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scale: position.scale,
      initialDistance: containerRect ? Math.sqrt(
        Math.pow(containerRect.right - e.clientX, 2) + 
        Math.pow(containerRect.bottom - e.clientY, 2)
      ) : 0,
    };
    
    const handleMouseMoveGlobal = (e: MouseEvent) => {
      handleMouseMove.current(e);
    };
    const handleMouseUpGlobal = () => {
      handleMouseUp.current();
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
    
    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);
  };

  return (
    <div
      ref={containerRef}
      className="ImageDisplay"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `scale(${position.scale})`,
        transformOrigin: 'top left',
        zIndex: 15,
        pointerEvents: 'auto',
        border: '2px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '4px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: '4px',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px',
          padding: '2px 4px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderRadius: '2px',
        }}
      >
        <span style={{ color: 'white', fontSize: '12px', userSelect: 'none' }}>{name}</span>
      </div>
      <div
        style={{
          position: 'relative',
          backgroundColor: 'white',
          display: 'inline-block',
        }}
      >
        <img
          src={imageData.imageUrl}
          alt={name}
          style={{
            maxWidth: '400px',
            maxHeight: '300px',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
            opacity: 1,
            backgroundColor: 'white',
          }}
          draggable={false}
        />
        <div
          className="ImageResizeHandle"
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '20px',
            height: '20px',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            cursor: 'nwse-resize',
            borderTopLeftRadius: '4px',
            borderBottomRightRadius: '4px',
            border: '2px solid rgba(0, 0, 0, 0.3)',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
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
    baseFrame: 'base_link',
    mapFrame: 'map',
    followZoomFactor: 0.3, // 跟随机器人时的缩放倍数（越小越放大）
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
      for (const [key, config] of Object.entries(saved)) {
        if (!DEFAULT_LAYER_CONFIGS[key] && config.id === 'image') {
          merged[key] = config;
        }
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mouseWorldPos, setMouseWorldPos] = useState<{ x: number; y: number } | null>(null);
  const [robotPos, setRobotPos] = useState<{ x: number; y: number; theta: number } | null>(null);
  const focusRobotRef = useRef(false);
  const followDistanceRef = useRef<number | null>(null);
  const initialFollowDistanceRef = useRef<number | null>(null);
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
  const [imageLayers, setImageLayers] = useState<Map<string, ImageLayerData>>(new Map());
  const imagePositionsRef = useRef<Map<string, { x: number; y: number; scale: number }>>(new Map());
  
  useEffect(() => {
    const saved = loadImagePositions();
    if (saved) {
      const map = new Map<string, { x: number; y: number; scale: number }>();
      for (const [layerId, position] of Object.entries(saved)) {
        map.set(layerId, position);
      }
      imagePositionsRef.current = map;
    }
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 10);
    directionalLight.castShadow = false;
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, -5, 5);
    directionalLight2.castShadow = false;
    scene.add(directionalLight2);

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

    const handleMouseMove = (event: MouseEvent) => {
      if (!camera || !canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersectPoint);
      
      setMouseWorldPos({ x: intersectPoint.x, y: intersectPoint.y });
    };

    const handleMouseLeave = () => {
      setMouseWorldPos(null);
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    console.log('[MapView] Creating LayerManager');
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

    const updateRobotPosition = () => {
      const robotConfig = layerConfigsRef.current.robot;
      if (!robotConfig) {
        setRobotPos(null);
        return;
      }

      const baseFrame = (robotConfig as any).baseFrame || 'base_link';
      const mapFrame = (robotConfig as any).mapFrame || 'map';
      const tf2js = TF2JS.getInstance();
      const transform = tf2js.findTransform(mapFrame, baseFrame);
      
      if (transform) {
        const robotEuler = new THREE.Euler();
        robotEuler.setFromQuaternion(transform.rotation, 'XYZ');
        const robotTheta = robotEuler.z;
        
        setRobotPos({
          x: transform.translation.x,
          y: transform.translation.y,
          theta: robotTheta,
        });
      } else {
        setRobotPos(null);
      }
    };

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controls && camera) {
        if (focusRobotRef.current) {
          const robotConfig = layerConfigsRef.current.robot;
          if (robotConfig) {
            const baseFrame = (robotConfig as any).baseFrame || 'base_link';
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
                initialFollowDistanceRef.current = currentDistance;
                const zoomFactor = (robotConfig as any).followZoomFactor ?? 0.3;
                followDistanceRef.current = Math.max(currentDistance * zoomFactor, controls.minDistance);
              }
              
              // 获取机器人方向（绕 Z 轴的旋转角度）
              const robotEuler = new THREE.Euler();
              robotEuler.setFromQuaternion(transform.rotation, 'XYZ');
              const robotTheta = robotEuler.z; // 机器人在 XY 平面的旋转角度（绕 Z 轴）
              
              if (viewModeRef.current === '2d') {
                camera.position.set(
                  controls.target.x,
                  controls.target.y,
                  controls.target.z + followDistanceRef.current
                );
                camera.up.set(0, 0, 1);
                // 根据机器人方向旋转相机，使机器人车头方向在屏幕正前方
                // 屏幕正前方是 -Y 方向，所以需要旋转 -robotTheta
                camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -robotTheta, 'XYZ'));
              } else {
                // 3D 模式下，调整相机位置使机器人车头方向在屏幕正前方
                const targetDistance = followDistanceRef.current;
                
                // 计算相机应该的位置（在机器人后方，高度适中）
                // 机器人车头方向是 (cos(robotTheta), sin(robotTheta), 0)
                // 相机应该在机器人后方，所以是 (-cos(robotTheta), -sin(robotTheta), height)
                const cameraHeight = targetDistance * 0.3; // 相机高度
                const cameraBackDistance = Math.sqrt(targetDistance * targetDistance - cameraHeight * cameraHeight);
                const cameraX = -Math.cos(robotTheta) * cameraBackDistance;
                const cameraY = -Math.sin(robotTheta) * cameraBackDistance;
                const cameraZ = cameraHeight;
                
                camera.position.set(
                  controls.target.x + cameraX,
                  controls.target.y + cameraY,
                  controls.target.z + cameraZ
                );
                
                // 相机看向机器人
                camera.lookAt(controls.target);
              }
            }
          }
        } else {
          followDistanceRef.current = null;
          initialFollowDistanceRef.current = null;
        }
        
        updateRobotPosition();
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
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
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
      if (layerId === '' && Object.keys(config).length === 0) {
        return prev;
      }
      if (updated[layerId]) {
        updated[layerId] = { ...updated[layerId]!, ...config };
      } else if (Object.keys(config).length > 0) {
        updated[layerId] = config as import('../types/LayerConfig').LayerConfig;
      }
      const filtered = Object.fromEntries(
        Object.entries(updated).filter(([_, cfg]) => cfg !== undefined)
      );
      saveLayerConfigs(filtered);
      return filtered;
    });
  };

  useEffect(() => {
    focusRobotRef.current = focusRobot;
  }, [focusRobot]);

  useEffect(() => {
    const handleImageUpdate = (event: CustomEvent) => {
      const { layerId: configId, imageUrl, width, height } = event.detail;
      if (imageUrl) {
        const matchingLayerId = Object.keys(layerConfigs).find(
          (id) => layerConfigs[id]?.id === configId
        );
        if (matchingLayerId) {
          setImageLayers((prev) => {
            const next = new Map(prev);
            next.set(matchingLayerId, { imageUrl, width, height, layerId: matchingLayerId });
            return next;
          });
          if (!imagePositionsRef.current.has(matchingLayerId)) {
            const savedPositions = loadImagePositions();
            const savedPosition = savedPositions?.[matchingLayerId];
            if (savedPosition) {
              imagePositionsRef.current.set(matchingLayerId, savedPosition);
            } else {
              imagePositionsRef.current.set(matchingLayerId, { x: 100, y: 100, scale: 1 });
            }
          }
        }
      }
    };

    window.addEventListener('imageLayerUpdate', handleImageUpdate as EventListener);
    return () => {
      window.removeEventListener('imageLayerUpdate', handleImageUpdate as EventListener);
    };
  }, [layerConfigs]);

  useEffect(() => {
    const imageLayerIds = new Set(imageLayers.keys());
    const configLayerIds = new Set(
      Object.entries(layerConfigs)
        .filter(([_, config]) => config.id === 'image')
        .map(([id]) => id)
    );
    
    for (const layerId of imageLayerIds) {
      if (!configLayerIds.has(layerId) || !layerConfigs[layerId]?.enabled) {
        setImageLayers((prev) => {
          const next = new Map(prev);
          next.delete(layerId);
          return next;
        });
        imagePositionsRef.current.delete(layerId);
        const positionsMap: ImagePositionsMap = {};
        imagePositionsRef.current.forEach((pos, id) => {
          positionsMap[id] = pos;
        });
        saveImagePositions(positionsMap);
      }
    }
  }, [layerConfigs, imageLayers]);

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
        initialFollowDistanceRef.current = currentDistance;
        // 应用缩放倍数
        const robotConfig = layerConfigsRef.current.robot;
        const zoomFactor = (robotConfig as any)?.followZoomFactor ?? 0.3;
        followDistanceRef.current = Math.max(currentDistance * zoomFactor, controls.minDistance);
      } else if (!prev) {
        followDistanceRef.current = 10;
        initialFollowDistanceRef.current = null;
      } else {
        // 取消跟随时，恢复原始距离
        if (initialFollowDistanceRef.current !== null) {
          followDistanceRef.current = initialFollowDistanceRef.current;
          initialFollowDistanceRef.current = null;
        }
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

  const handleFullscreenToggle = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('全屏操作失败:', error);
      toast.error('全屏操作失败');
    }
  };


  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

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
        <button
          className={`SettingsButton ${isFullscreen ? 'active' : ''}`}
          onClick={handleFullscreenToggle}
          title={isFullscreen ? '退出全屏' : '进入全屏'}
          type="button"
        >
          {isFullscreen ? '🔳' : '🔲'}
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
          onDeleteLayer={(layerId) => {
            setLayerConfigs((prev) => {
              const updated = { ...prev };
              delete updated[layerId];
              saveLayerConfigs(updated);
              return updated;
            });
            imagePositionsRef.current.delete(layerId);
            const positionsMap: ImagePositionsMap = {};
            imagePositionsRef.current.forEach((pos, id) => {
              positionsMap[id] = pos;
            });
            saveImagePositions(positionsMap);
          }}
          onUrdfConfigChange={async () => {
            const robotLayer = layerManagerRef.current?.getLayer('robot');
            if (robotLayer && 'reloadUrdf' in robotLayer) {
              try {
                await (robotLayer as any).reloadUrdf();
              } catch (error) {
                console.error('[MapView] Failed to reload URDF:', error);
                toast.error('加载 URDF 模型失败: ' + (error instanceof Error ? error.message : '未知错误'));
              }
            }
          }}
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
      {Array.from(imageLayers.entries())
        .filter(([layerId]) => layerConfigs[layerId]?.enabled)
        .map(([layerId, imageData]) => {
          const config = layerConfigs[layerId];
          const position = imagePositionsRef.current.get(layerId) || { x: 100, y: 100, scale: 1 };
          return (
            <ImageDisplay
              key={layerId}
              imageData={imageData}
              name={config?.name || layerId}
              position={position}
              onPositionChange={(newPos) => {
                imagePositionsRef.current.set(layerId, newPos);
                const positionsMap: ImagePositionsMap = {};
                imagePositionsRef.current.forEach((pos, id) => {
                  positionsMap[id] = pos;
                });
                saveImagePositions(positionsMap);
              }}
            />
          );
        })}
      <div className="CoordinateDisplay">
        <div className="CoordinateRow">
          <span className="CoordinateLabel">鼠标:</span>
          <span className="CoordinateValue">
            {mouseWorldPos
              ? `X: ${mouseWorldPos.x.toFixed(3)}, Y: ${mouseWorldPos.y.toFixed(3)}`
              : '-'}
          </span>
        </div>
        <div className="CoordinateRow">
          <span className="CoordinateLabel">机器人:</span>
          <span className="CoordinateValue">
            {robotPos
              ? `X: ${robotPos.x.toFixed(3)}, Y: ${robotPos.y.toFixed(3)}, θ: ${robotPos.theta.toFixed(3)}`
              : '-'}
          </span>
        </div>
      </div>
    </div>
  );
}
