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
import { ImageDisplay } from './ImageDisplay';
import { ManualControlPanel } from './ManualControlPanel';
import { TopoPointInfoPanel } from './TopoPointInfoPanel';
import { DEFAULT_LAYER_CONFIGS } from '../constants/layerConfigs';
import { loadLayerConfigs, saveLayerConfigs, saveImagePositions, type ImagePositionsMap } from '../utils/layerConfigStorage';
import { useLayerConfigSync } from '../hooks/useLayerConfigSync';
import { useManualControl } from '../hooks/useManualControl';
import { useInitialization } from '../hooks/useInitialization';
import { useImageLayers } from '../hooks/useImageLayers';
import { useRelocalizeMode } from '../hooks/useRelocalizeMode';
import { useViewMode } from '../hooks/useViewMode';
import { useFullscreen } from '../hooks/useFullscreen';
import { useConnectionInit } from '../hooks/useConnectionInit';
import './MapView.css';

interface MapViewProps {
  connection: RosbridgeConnection;
}

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
        if (!DEFAULT_LAYER_CONFIGS[key] && (config.id === 'image' || config.id === 'cmd_vel')) {
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
  const isFullscreen = useFullscreen();
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
  const imagePositionsRef = useRef<Map<string, { x: number; y: number; scale: number }>>(new Map());
  const [manualControlMode, setManualControlMode] = useState(false);
  const activeKeysRef = useRef<Set<string>>(new Set());
  const cmdVelTopicRef = useRef<string>('/cmd_vel');
  const cmdVelIntervalRef = useRef<number | null>(null);
  const timeoutRefsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [relocalizeMode, setRelocalizeMode] = useState(false);
  const relocalizeModeRef = useRef(false);
  const relocalizeRobotPosRef = useRef<{ x: number; y: number; theta: number } | null>(null);
  const isDraggingRobotRef = useRef(false);
  const isRotatingRobotRef = useRef(false);
  const initialposeTopicRef = useRef<string>('/initialpose');
  const relocalizeButtonRef = useRef<HTMLButtonElement>(null);
  const relocalizeControlsRef = useRef<HTMLDivElement>(null);
  
  useInitialization(cmdVelTopicRef, initialposeTopicRef, imagePositionsRef);
  
  const imageLayers = useImageLayers(layerConfigs, imagePositionsRef);
  
  const relocalizeControlsStyle = useRelocalizeMode(
    relocalizeMode,
    viewMode,
    layerConfigsRef,
    layerManagerRef,
    controlsRef,
    relocalizeButtonRef,
    relocalizeControlsRef,
    relocalizeRobotPosRef,
    relocalizeModeRef
  );
  
  useViewMode(viewMode, viewModeRef, controlsRef, cameraRef);

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
      
      if (relocalizeMode) {
        return;
      }
      
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
    
    const handleMouseDown = (event: MouseEvent) => {
      if (!relocalizeModeRef.current || !camera || !canvas || !scene) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj) {
          if (obj.userData.isRobot) {
            console.log('[MapView] Robot clicked, starting drag/rotate');
            if (event.button === 0) {
              isDraggingRobotRef.current = true;
              const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
              const intersectPoint = new THREE.Vector3();
              raycaster.ray.intersectPlane(plane, intersectPoint);
              if (relocalizeRobotPosRef.current) {
                relocalizeRobotPosRef.current.x = intersectPoint.x;
                relocalizeRobotPosRef.current.y = intersectPoint.y;
                console.log('[MapView] Robot position set to:', relocalizeRobotPosRef.current);
              }
            } else if (event.button === 2) {
              isRotatingRobotRef.current = true;
              console.log('[MapView] Robot rotation started');
            }
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          obj = obj.parent as THREE.Object3D;
        }
      }
    };
    
    const handleMouseUp = () => {
      isDraggingRobotRef.current = false;
      isRotatingRobotRef.current = false;
    };
    
    const handleContextMenu = (event: MouseEvent) => {
      if (relocalizeModeRef.current) {
        event.preventDefault();
      }
    };

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
      
      if (relocalizeModeRef.current) {
        if (isDraggingRobotRef.current && relocalizeRobotPosRef.current) {
          relocalizeRobotPosRef.current.x = intersectPoint.x;
          relocalizeRobotPosRef.current.y = intersectPoint.y;
          const robotLayer = layerManagerRef.current?.getLayer('robot');
          if (robotLayer && 'setRelocalizePosition' in robotLayer) {
            (robotLayer as any).setRelocalizePosition(relocalizeRobotPosRef.current);
          }
          const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
          if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
            (laserScanLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
          }
        }
      }
      
      setMouseWorldPos({ x: intersectPoint.x, y: intersectPoint.y });
    };
    
    const handleRightMouseMove = (event: MouseEvent) => {
      if (!relocalizeModeRef.current || !isRotatingRobotRef.current || !camera || !canvas || !relocalizeRobotPosRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersectPoint);
      
      const dx = intersectPoint.x - relocalizeRobotPosRef.current.x;
      const dy = intersectPoint.y - relocalizeRobotPosRef.current.y;
      relocalizeRobotPosRef.current.theta = Math.atan2(dy, dx);
      
      const robotLayer = layerManagerRef.current?.getLayer('robot');
      if (robotLayer && 'setRelocalizePosition' in robotLayer) {
        (robotLayer as any).setRelocalizePosition(relocalizeRobotPosRef.current);
      }
      const laserScanLayer = layerManagerRef.current?.getLayer('laser_scan');
      if (laserScanLayer && 'setRelocalizeMode' in laserScanLayer) {
        (laserScanLayer as any).setRelocalizeMode(true, relocalizeRobotPosRef.current);
      }
    };

    const handleMouseLeave = () => {
      setMouseWorldPos(null);
    };
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    const handleMouseMoveWrapper = (event: MouseEvent) => {
      handleMouseMove(event);
      if (event.buttons === 2) {
        handleRightMouseMove(event);
      }
    };
    canvas.addEventListener('mousemove', handleMouseMoveWrapper);
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
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mousemove', handleMouseMoveWrapper);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
      timeoutRefsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
      timeoutRefsRef.current.clear();
      controls.dispose();
      layerManager.dispose();
      if (renderer) {
        renderer.dispose();
      }
    };
  }, [connection]);

  useConnectionInit(connection, layerManagerRef, layerConfigs);

  useLayerConfigSync(
    layerConfigs,
    layerConfigsRef,
    layerManagerRef,
    connection,
    cmdVelTopicRef,
    initialposeTopicRef
  );

  useManualControl(
    manualControlMode,
    connection,
    cmdVelTopicRef,
    activeKeysRef,
    cmdVelIntervalRef
  );

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
  
  const handleRelocalizeToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const newMode = !relocalizeMode;
    setRelocalizeMode(newMode);
    if (newMode) {
      if (viewMode !== '2d') {
        setViewMode('2d');
        viewModeRef.current = '2d';
      }
      
      const timeoutId = setTimeout(() => {
        if (!controlsRef.current || !cameraRef.current) return;
        
        const robotConfig = layerConfigsRef.current.robot;
        if (robotConfig) {
          const baseFrame = (robotConfig as any).baseFrame || 'base_link';
          const mapFrame = (robotConfig as any).mapFrame || 'map';
          const tf2js = TF2JS.getInstance();
          const transform = tf2js.findTransform(mapFrame, baseFrame);
          
          if (transform) {
            const controls = controlsRef.current;
            const camera = cameraRef.current;
            
            controls.target.set(
              transform.translation.x,
              transform.translation.y,
              0
            );
            
            const distance = Math.max(10, camera.position.distanceTo(controls.target));
            camera.position.set(
              controls.target.x,
              controls.target.y,
              controls.target.z + distance
            );
            camera.up.set(0, 0, 1);
            camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
            
            controls.update();
          } else if (relocalizeRobotPosRef.current) {
            const controls = controlsRef.current;
            const camera = cameraRef.current;
            const pos = relocalizeRobotPosRef.current;
            
            controls.target.set(pos.x, pos.y, 0);
            
            const distance = Math.max(10, camera.position.distanceTo(controls.target));
            camera.position.set(
              controls.target.x,
              controls.target.y,
              controls.target.z + distance
            );
            camera.up.set(0, 0, 1);
            camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
            
            controls.update();
          }
        }
        timeoutRefsRef.current.delete(timeoutId);
      }, 100);
      timeoutRefsRef.current.add(timeoutId);
    }
  };
  
  const handleRelocalizeConfirm = () => {
    if (!relocalizeRobotPosRef.current || !connection.isConnected()) {
      toast.error('无法发布初始化位姿');
      return;
    }
    
    const pos = relocalizeRobotPosRef.current;
    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(new THREE.Euler(0, 0, pos.theta, 'XYZ'));
    
    const robotConfig = layerConfigsRef.current.robot;
    const mapFrame = (robotConfig as any)?.mapFrame || 'map';
    
    const message = {
      header: {
        stamp: {
          sec: Math.floor(Date.now() / 1000),
          nanosec: (Date.now() % 1000) * 1000000,
        },
        frame_id: mapFrame,
      },
      pose: {
        pose: {
          position: {
            x: pos.x,
            y: pos.y,
            z: 0,
          },
          orientation: {
            x: quaternion.x,
            y: quaternion.y,
            z: quaternion.z,
            w: quaternion.w,
          },
        },
        covariance: new Array(36).fill(0),
      },
    };
    
    connection.publish(initialposeTopicRef.current, 'geometry_msgs/PoseWithCovarianceStamped', message);
    toast.success('初始化位姿已发布');
    setRelocalizeMode(false);
  };
  
  const handleRelocalizeCancel = () => {
    setRelocalizeMode(false);
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
        <button
          className={`SettingsButton ${isFullscreen ? 'active' : ''}`}
          onClick={handleFullscreenToggle}
          title={isFullscreen ? '退出全屏' : '进入全屏'}
          type="button"
        >
          {isFullscreen ? '🔳' : '🔲'}
        </button>
        <button
          className={`SettingsButton ${manualControlMode ? 'active' : ''}`}
          onClick={() => setManualControlMode(!manualControlMode)}
          title={manualControlMode ? '退出手动控制' : '手动控制'}
          type="button"
        >
          🎮
        </button>
        <button
          ref={relocalizeButtonRef}
          className={`SettingsButton ${relocalizeMode ? 'active' : ''}`}
          onClick={handleRelocalizeToggle}
          title={relocalizeMode ? '退出重定位' : '重定位'}
          type="button"
        >
          📍
        </button>
      </div>
      {relocalizeMode && (
        <div ref={relocalizeControlsRef} className="RelocalizeControls" style={relocalizeControlsStyle}>
          <button
            className="RelocalizeButton ConfirmButton"
            onClick={handleRelocalizeConfirm}
            type="button"
          >
            确定
          </button>
          <button
            className="RelocalizeButton CancelButton"
            onClick={handleRelocalizeCancel}
            type="button"
          >
            取消
          </button>
        </div>
      )}
      {manualControlMode && (
        <ManualControlPanel
          layerConfigs={layerConfigs}
          cmdVelTopic={cmdVelTopicRef.current}
          connection={connection}
          activeKeysRef={activeKeysRef}
        />
      )}
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
      <TopoPointInfoPanel
        selectedPoint={selectedTopoPoint}
        selectedRoute={selectedTopoRoute}
        onClose={() => {
          setSelectedTopoPoint(null);
          setSelectedTopoRoute(null);
          const topoLayer = layerManagerRef.current?.getLayer('topology');
          if (topoLayer && 'setSelectedPoint' in topoLayer) {
            (topoLayer as any).setSelectedPoint(null);
          }
          if (topoLayer && 'setSelectedRoute' in topoLayer) {
            (topoLayer as any).setSelectedRoute(null);
          }
        }}
        connection={connection}
      />
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
        {relocalizeMode && relocalizeRobotPosRef.current ? (
          <div className="CoordinateRow">
            <span className="CoordinateLabel">重定位位置:</span>
            <span className="CoordinateValue">
              X: {relocalizeRobotPosRef.current.x.toFixed(3)}, Y: {relocalizeRobotPosRef.current.y.toFixed(3)}, θ: {relocalizeRobotPosRef.current.theta.toFixed(3)}
            </span>
          </div>
        ) : (
          <div className="CoordinateRow">
            <span className="CoordinateLabel">机器人:</span>
            <span className="CoordinateValue">
              {robotPos
                ? `X: ${robotPos.x.toFixed(3)}, Y: ${robotPos.y.toFixed(3)}, θ: ${robotPos.theta.toFixed(3)}`
                : '-'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
