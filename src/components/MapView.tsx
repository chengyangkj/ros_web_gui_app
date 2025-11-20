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
import { loadLayerConfigs, saveLayerConfigs } from '../utils/layerConfigStorage';
import { saveUrdfConfig, type UrdfConfig } from '../utils/urdfStorage';
import { saveUrdfFile, saveUrdfFiles } from '../utils/urdfFileStorage';
import JSZip from 'jszip';
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
      return merged;
    }
    return DEFAULT_LAYER_CONFIGS;
  });
  const layerConfigsRef = useRef<LayerConfigMap>(layerConfigs);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const viewModeRef = useRef<'2d' | '3d'>('2d');
  const [showSettings, setShowSettings] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showUrdfSelector, setShowUrdfSelector] = useState(false);
  const [urdfFileOptions, setUrdfFileOptions] = useState<{ files: string[], zip: JSZip | null, filesToSave: Map<string, string | ArrayBuffer> }>({ files: [], zip: null, filesToSave: new Map() });
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

      const baseFrame = (robotConfig as any).baseFrame || 'base_center';
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

  const urdfFileInputRef = useRef<HTMLInputElement>(null);

  const handleUrdfUpload = () => {
    urdfFileInputRef.current?.click();
  };

  const extractMeshPaths = (urdfText: string): string[] => {
    const meshPaths: string[] = [];
    const meshRegex = /<mesh\s+filename=["']([^"']+)["']/gi;
    let match;
    while ((match = meshRegex.exec(urdfText)) !== null) {
      meshPaths.push(match[1]);
    }
    return meshPaths;
  };

  const handleUrdfFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      let urdfFileName = '';
      let urdfContent = '';
      const filesToSave = new Map<string, string | ArrayBuffer>();

      if (file.name.endsWith('.zip') || file.name.endsWith('.ZIP')) {
        // 处理 ZIP 文件
        toast.info('正在解压 ZIP 文件...');
        const zip = await JSZip.loadAsync(file);
        const fileNames = Object.keys(zip.files);
        
        // 查找 URDF 文件
        const urdfFiles = fileNames.filter(name => 
          name.toLowerCase().endsWith('.urdf') && !zip.files[name].dir
        );
        
        if (urdfFiles.length === 0) {
          toast.error('ZIP 文件中未找到 URDF 文件');
          return;
        }
        
        // 提取所有文件
        for (const fileName of fileNames) {
          const zipFile = zip.files[fileName];
          if (!zipFile.dir) {
            const content = await zipFile.async('uint8array');
            const buffer = new ArrayBuffer(content.length);
            new Uint8Array(buffer).set(content);
            filesToSave.set(fileName, buffer);
          }
        }
        
        // 如果只有一个 URDF 文件，直接使用；否则让用户选择
        if (urdfFiles.length === 1) {
          urdfFileName = urdfFiles[0];
          urdfContent = await zip.files[urdfFileName].async('string');
          await saveUrdfFiles(filesToSave);
          toast.success(`已解压 ${filesToSave.size} 个文件`);
        } else {
          // 多个 URDF 文件，显示选择对话框
          setUrdfFileOptions({ files: urdfFiles, zip, filesToSave });
          setShowUrdfSelector(true);
          return;
        }
      } else if (file.name.endsWith('.urdf') || file.name.endsWith('.URDF')) {
        // 处理单个 URDF 文件
        urdfFileName = file.name;
        urdfContent = await file.text();
        await saveUrdfFile(urdfFileName, urdfContent);
        
        // 尝试提取 mesh 路径并提示用户
        const meshPaths = extractMeshPaths(urdfContent);
        if (meshPaths.length > 0) {
          toast.warning(`检测到 ${meshPaths.length} 个 mesh 文件引用。建议上传包含所有文件的 ZIP 压缩包。`);
        }
      } else {
        toast.error('请选择 URDF 文件或包含 URDF 的 ZIP 压缩包');
        return;
      }

      // 解析 packages
      const packages: Record<string, string> = {};
      const packageMatches = urdfContent.matchAll(/file:\/\/\$\(find\s+([^)]+)\)/g);
      for (const match of packageMatches) {
        const packageName = match[1];
        if (!packages[packageName]) {
          packages[packageName] = '/urdf/';
        }
      }
      
      if (Object.keys(packages).length === 0) {
        packages['nav_bringup'] = '/urdf/x2w/';
      }

      const config: UrdfConfig = {
        packages,
        fileName: urdfFileName,
      };

      saveUrdfConfig(config);
      toast.success(`URDF 文件已保存: ${urdfFileName}`);
      
      // 重新加载机器人模型
      const robotLayer = layerManagerRef.current?.getLayer('robot');
      if (robotLayer && 'reloadUrdf' in robotLayer) {
        (robotLayer as any).reloadUrdf();
      }
    } catch (error) {
      console.error('上传 URDF 失败:', error);
      toast.error('上传 URDF 失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      if (urdfFileInputRef.current) {
        urdfFileInputRef.current.value = '';
      }
    }
  };

  const handleUrdfFileSelectConfirm = async (selectedFileName: string) => {
    try {
      const { zip, filesToSave } = urdfFileOptions;
      if (!zip) return;

      const urdfContent = await zip.files[selectedFileName].async('string');
      
      // 保存所有文件
      await saveUrdfFiles(filesToSave);
      toast.success(`已解压 ${filesToSave.size} 个文件`);

      // 解析 packages
      const packages: Record<string, string> = {};
      const packageMatches = urdfContent.matchAll(/file:\/\/\$\(find\s+([^)]+)\)/g);
      for (const match of packageMatches) {
        const packageName = match[1];
        if (!packages[packageName]) {
          packages[packageName] = '/urdf/';
        }
      }
      
      if (Object.keys(packages).length === 0) {
        packages['nav_bringup'] = '/urdf/x2w/';
      }

      const config: UrdfConfig = {
        packages,
        fileName: selectedFileName,
      };

      saveUrdfConfig(config);
      toast.success(`URDF 文件已保存: ${selectedFileName}`);
      
      // 重新加载机器人模型
      const robotLayer = layerManagerRef.current?.getLayer('robot');
      if (robotLayer && 'reloadUrdf' in robotLayer) {
        (robotLayer as any).reloadUrdf();
      }

      setShowUrdfSelector(false);
      setUrdfFileOptions({ files: [], zip: null, filesToSave: new Map() });
    } catch (error) {
      console.error('处理 URDF 文件失败:', error);
      toast.error('处理 URDF 文件失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleUrdfFileSelectCancel = () => {
    setShowUrdfSelector(false);
    setUrdfFileOptions({ files: [], zip: null, filesToSave: new Map() });
    if (urdfFileInputRef.current) {
      urdfFileInputRef.current.value = '';
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
        <button
          className="SettingsButton"
          onClick={handleUrdfUpload}
          title="上传 URDF 文件"
          type="button"
        >
          🤖
        </button>
      </div>
      <input
        ref={urdfFileInputRef}
        type="file"
        accept=".urdf,.URDF,.zip,.ZIP"
        style={{ display: 'none' }}
        onChange={handleUrdfFileSelect}
      />
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
      {showUrdfSelector && (
        <div className="UrdfSelectorDialog" style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          zIndex: 10000,
          minWidth: '400px',
          maxWidth: '600px',
        }}>
          <div style={{ marginBottom: '15px' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>选择 URDF 文件</h3>
            <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
              检测到多个 URDF 文件，请选择要使用的文件：
            </p>
          </div>
          <div style={{ marginBottom: '15px', maxHeight: '300px', overflowY: 'auto' }}>
            {urdfFileOptions.files.map((fileName) => (
              <button
                key={fileName}
                onClick={() => handleUrdfFileSelectConfirm(fileName)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px',
                  marginBottom: '8px',
                  textAlign: 'left',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e8e8e8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f5f5f5';
                }}
                type="button"
              >
                {fileName}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              onClick={handleUrdfFileSelectCancel}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f0f0f0',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {showUrdfSelector && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 9999,
          }}
          onClick={handleUrdfFileSelectCancel}
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
