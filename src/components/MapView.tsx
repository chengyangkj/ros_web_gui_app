import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toast } from 'react-toastify';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { LayerManager } from './layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';
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
    visible: true,
  },
  occupancy_grid: {
    id: 'occupancy_grid',
    name: '栅格地图',
    topic: '/map',
    messageType: 'nav_msgs/OccupancyGrid',
    enabled: true,
    visible: true,
  },
  laser_scan: {
    id: 'laser_scan',
    name: '激光雷达',
    topic: '/scan',
    messageType: 'sensor_msgs/LaserScan',
    enabled: true,
    visible: true,
    targetFrame: 'map',
  },
  robot: {
    id: 'robot',
    name: '机器人位置',
    topic: null,
    messageType: null,
    enabled: true,
    visible: true,
    baseFrame: 'base_center',
    mapFrame: 'map',
  },
  local_plan: {
    id: 'local_plan',
    name: '局部路径',
    topic: '/local_plan',
    messageType: 'nav_msgs/Path',
    enabled: true,
    visible: true,
    color: 0x00ff00,
  },
  plan: {
    id: 'plan',
    name: '全局路径',
    topic: '/plan',
    messageType: 'nav_msgs/Path',
    enabled: true,
    visible: true,
    color: 0x0000ff,
  },
  footprint: {
    id: 'footprint',
    name: 'Footprint',
    topic: '/local_costmap/published_footprint',
    messageType: 'geometry_msgs/PolygonStamped',
    enabled: true,
    visible: true,
  },
  tf: {
    id: 'tf',
    name: 'TF坐标系',
    topic: null,
    messageType: null,
    enabled: true,
    visible: true,
  },
};

export function MapView({ connection }: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const layerManagerRef = useRef<LayerManager | null>(null);
  const [layerConfigs] = useState<LayerConfigMap>(DEFAULT_LAYER_CONFIGS);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const viewModeRef = useRef<'2d' | '3d'>('2d');

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
        controls.update();
      }
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
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

        const topicList = Object.values(layerConfigs)
          .filter((c) => c.enabled && c.visible && c.topic)
          .map((c) => c.topic)
          .join(', ');
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
    if (layerManagerRef.current && connection.isConnected()) {
      layerManagerRef.current.setLayerConfigs(layerConfigs);
    }
  }, [layerConfigs, connection]);

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
      </div>
      <canvas ref={canvasRef} className="MapCanvas" />
    </div>
  );
}
