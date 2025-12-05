import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toast } from 'react-toastify';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { LayerManager } from './layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';
import { TopoLayer } from './layers/TopoLayer';
import { OccupancyGridLayer } from './layers/OccupancyGridLayer';
import { MapManager } from '../utils/MapManager';
import type { TopoPoint, Route, RouteInfo } from '../utils/MapManager';
import {
  CommandManager,
  AddPointCommand,
  DeletePointCommand,
  ModifyPointCommand,
  AddRouteCommand,
  DeleteRouteCommand,
  ModifyRouteCommand,
  ModifyGridCommand,
  type GridCellChange,
} from '../utils/CommandManager';
import { exportMap } from '../utils/mapExporter';
import { importMap } from '../utils/mapImporter';
import './MapEditor.css';

interface MapEditorProps {
  connection: RosbridgeConnection;
  onClose: () => void;
}

type EditTool = 'move' | 'addPoint' | 'addRoute' | 'brush' | 'eraser' | 'drawLine';

const DEFAULT_EDITOR_CONFIGS: LayerConfigMap = {
  occupancy_grid: {
    id: 'occupancy_grid',
    name: '栅格地图',
    topic: '/map',
    messageType: 'nav_msgs/OccupancyGrid',
    enabled: true,
    colorMode: 'map',
    height: 0,
  },
  topology: {
    id: 'topology',
    name: 'Topo地图',
    topic: '/map/topology',
    messageType: null,
    enabled: true,
    color: 0x2196f3,
    pointSize: 0.2,
  },
};

export function MapEditor({ connection, onClose }: MapEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const layerManagerRef = useRef<LayerManager | null>(null);
  const topoLayerRef = useRef<TopoLayer | null>(null);
  const occupancyGridLayerRef = useRef<OccupancyGridLayer | null>(null);
  const [currentTool, setCurrentTool] = useState<EditTool>('move');
  const [brushSize, setBrushSize] = useState<number>(0.05);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const lastDrawPosRef = useRef<THREE.Vector3 | null>(null);
  const brushIndicatorRef = useRef<HTMLDivElement | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<TopoPoint | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportMapName, setExportMapName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragStartPos, setDragStartPos] = useState<THREE.Vector2 | null>(null);
  const [routeStartPoint, setRouteStartPoint] = useState<string | null>(null);
  const [lineStartPoint, setLineStartPoint] = useState<THREE.Vector3 | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const mapManagerRef = useRef<MapManager>(MapManager.getInstance());
  const commandManagerRef = useRef<CommandManager>(new CommandManager());
  const selectedPointRef = useRef<THREE.Group | null>(null);
  const previewLineRef = useRef<THREE.Line | null>(null);
  const selectedPointStateRef = useRef<TopoPoint | null>(null);
  const selectedRouteStateRef = useRef<Route | null>(null);
  const currentGridChangesRef = useRef<Map<number, { oldValue: number; newValue: number }>>(new Map());
  const timeoutRefsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const initialGridValuesRef = useRef<Map<number, number>>(new Map());
  const dragStartPointRef = useRef<TopoPoint | null>(null);
  const [supportControllers, setSupportControllers] = useState<string[]>(['FollowPath']);
  const [supportGoalCheckers, setSupportGoalCheckers] = useState<string[]>(['general_goal_checker']);
  const [mouseWorldPos, setMouseWorldPos] = useState<{ x: number; y: number } | null>(null);
  const [robotPos, setRobotPos] = useState<{ x: number; y: number; theta: number } | null>(null);
  const [editingPoint, setEditingPoint] = useState<TopoPoint | null>(null);

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
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 1000;
    controls.target.set(0, 0, 0);
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    (controls as OrbitControls & { zoomToCursor?: boolean }).zoomToCursor = true;

    // 固定为2D模式：禁用旋转，设置相机为俯视图
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.enablePan = true;
    camera.up.set(0, 0, 1);
    camera.position.set(0, 0, 10);
    camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
    controls.update();
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    raycasterRef.current = raycaster;

    const layerManager = new LayerManager(scene, connection);
    layerManagerRef.current = layerManager;

    // 获取 topology layer 引用
    const topoLayer = layerManager.getLayer('topology') as TopoLayer | undefined;
    if (topoLayer) {
      topoLayerRef.current = topoLayer;
    }

    // 获取 occupancy_grid layer 引用
    const occupancyGridLayer = layerManager.getLayer('occupancy_grid');
    if (occupancyGridLayer instanceof OccupancyGridLayer) {
      occupancyGridLayerRef.current = occupancyGridLayer;
    }

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
      const tf2js = TF2JS.getInstance();
      const transform = tf2js.findTransform('map', 'base_link');

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
        const availableFrames = tf2js.getFrames();
        if (availableFrames.length > 0) {
          setRobotPos(null);
        }
      }
    };

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controls && camera) {
        // 强制保持2D视图：确保相机始终从上方俯视
        camera.up.set(0, 0, 1);
        const targetZ = 0;
        const distance = Math.max(Math.abs(camera.position.z - targetZ), controls.minDistance);
        camera.position.set(controls.target.x, controls.target.y, targetZ + distance);
        camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
        controls.update();
      }
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
      updateRobotPosition();
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      timeoutRefsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
      timeoutRefsRef.current.clear();
      clearPreviewLine();
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

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let handleMapUpdate: (() => void) | null = null;

    const initializeAndSubscribe = async () => {
      try {
        await connection.initializeMessageReaders();
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(DEFAULT_EDITOR_CONFIGS);

        const mapManager = mapManagerRef.current;
        mapManager.initialize(connection);

        handleMapUpdate = () => {
          updateTopoMap();
        };
        mapManager.addTopologyListener(handleMapUpdate);

        timeoutId = setTimeout(() => {
          const topoLayer = layerManagerRef.current?.getLayer('topology') as TopoLayer | undefined;
          if (topoLayer) {
            topoLayerRef.current = topoLayer;
            updateTopoMap();
          }

          const occupancyGridLayer = layerManagerRef.current?.getLayer('occupancy_grid');
          if (occupancyGridLayer instanceof OccupancyGridLayer) {
            occupancyGridLayerRef.current = occupancyGridLayer;
          }
        }, 500);
      } catch (error) {
        console.error('Failed to initialize message readers:', error);
        toast.error('初始化失败，使用默认配置...');
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(DEFAULT_EDITOR_CONFIGS);
      }
    };

    void initializeAndSubscribe();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (handleMapUpdate && mapManagerRef.current) {
        mapManagerRef.current.removeTopologyListener(handleMapUpdate);
      }
      mapManagerRef.current.disconnect();
    };
  }, [connection]);

  useEffect(() => {
    if (!connection.isConnected()) {
      return;
    }

    const updateRobotPosition = () => {
      const tf2js = TF2JS.getInstance();
      const transform = tf2js.findTransform('map', 'base_link');

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
        const availableFrames = tf2js.getFrames();
        if (availableFrames.length > 0) {
          setRobotPos(null);
        }
      }
    };

    const tf2js = TF2JS.getInstance();
    const unsubscribe = tf2js.onTransformChange(() => {
      updateRobotPosition();
    });

    updateRobotPosition();

    const intervalId = setInterval(() => {
      updateRobotPosition();
    }, 100);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [connection]);

  const getWorldPosition = (event: MouseEvent): THREE.Vector3 | null => {
    if (!cameraRef.current || !canvasRef.current) return null;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = raycasterRef.current;
    if (!raycaster) return null;

    raycaster.setFromCamera(mouse, cameraRef.current);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);

    return intersectPoint;
  };

  const handleCanvasClick = (event: MouseEvent) => {
    if (!sceneRef.current || !cameraRef.current || isDragging || isRotating) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current!.setFromCamera(mouse, cameraRef.current);
    const intersects = raycasterRef.current!.intersectObjects(sceneRef.current.children, true);

    if (currentTool === 'drawLine') {
      // 直线绘制工具：点击空白区域设置起始点和结束点
      const worldPos = getWorldPosition(event);
      if (!worldPos || !occupancyGridLayerRef.current) return;

      if (!lineStartPoint) {
        setLineStartPoint(worldPos);
        createPreviewLine(worldPos.x, worldPos.y, worldPos.x, worldPos.y);
        toast.info('已设置起始点，点击设置结束点');
      } else {
        const endPos = worldPos;
        const changes = occupancyGridLayerRef.current.drawLine(
          lineStartPoint.x,
          lineStartPoint.y,
          endPos.x,
          endPos.y,
          100,
          brushSize
        );

        if (changes.length > 0) {
          const command = new ModifyGridCommand(
            occupancyGridLayerRef.current,
            changes,
            () => { }
          );
          commandManagerRef.current.executeCommand(command);
        }

        clearPreviewLine();
        setLineStartPoint(null);
        toast.success('已绘制直线');
      }
      return;
    }

    if (currentTool === 'addRoute') {
      // 连线工具：优先处理点位点击进行连线
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj) {
          if (obj.userData.isTopoPoint && obj.userData.topoPoint) {
            const point = obj.userData.topoPoint;
            if (!routeStartPoint) {
              setRouteStartPoint(point.name);
              // 创建预览线段
              const mapManager = mapManagerRef.current;
              const startPoint = mapManager.getTopologyPoint(point.name);
              if (startPoint) {
                createPreviewLine(startPoint.x, startPoint.y, startPoint.x, startPoint.y);
              }
            } else if (routeStartPoint !== point.name) {
              // 检查是否已存在相同方向的路线（A->B 和 B->A 是不同的路线）
              const mapManager = mapManagerRef.current;
              const exists = mapManager.getTopologyRoutes().some(
                r => r.from_point === routeStartPoint && r.to_point === point.name
              );
              if (!exists) {
                // 创建路线
                const newRoute: Route = {
                  from_point: routeStartPoint,
                  to_point: point.name,
                  route_info: {
                    controller: 'FollowPath',
                    goal_checker: 'general_goal_checker',
                    speed_limit: 1.0,
                  },
                };
                const command = new AddRouteCommand(mapManager, newRoute, updateTopoMap);
                commandManagerRef.current.executeCommand(command);
                setRouteStartPoint(null);
                setSelectedRoute(newRoute);
                setSelectedPoint(null);
                const topoLayer = layerManagerRef.current?.getLayer('topology');
                if (topoLayer instanceof TopoLayer) {
                  topoLayer.setSelectedRoute(newRoute);
                  topoLayer.setSelectedPoint(null);
                }
                clearPreviewLine();
                toast.success(`已创建路线: ${routeStartPoint} -> ${point.name}`);
              } else {
                toast.warning('路线已存在');
                setRouteStartPoint(null);
                clearPreviewLine();
              }
            }
            return;
          }
          obj = obj.parent as THREE.Object3D;
        }
      }

      // 点击空白区域，取消选中（仅在连线工具模式下）
      setSelectedPoint(null);
      setSelectedRoute(null);
      setRouteStartPoint(null);
      const topoLayer = layerManagerRef.current?.getLayer('topology');
      if (topoLayer instanceof TopoLayer) {
        topoLayer.setSelectedPoint(null);
        topoLayer.setSelectedRoute(null);
      }
      clearPreviewLine();
      return;
    }

    // 非连线模式下，检查是否点击了路线（优先级高于点位，因为路线在点位下方）
    for (const intersect of intersects) {
      let obj = intersect.object;
      while (obj) {
        if (obj.userData.isTopoRoute && obj.userData.topoRoute) {
          const route = obj.userData.topoRoute;
          setSelectedRoute(route);
          setSelectedPoint(null);
          const topoLayer = layerManagerRef.current?.getLayer('topology');
          if (topoLayer instanceof TopoLayer) {
            topoLayer.setSelectedRoute(route);
            topoLayer.setSelectedPoint(null);
          }
          return;
        }
        obj = obj.parent as THREE.Object3D;
      }
    }

    // 检查是否点击了点位
    for (const intersect of intersects) {
      let obj = intersect.object;
      while (obj) {
        if (obj.userData.isTopoPoint && obj.userData.topoPoint) {
          const point = obj.userData.topoPoint;
          const mapManager = mapManagerRef.current;
          const pointData = mapManager.getTopologyPoint(point.name);
          if (pointData) {
            setSelectedPoint(pointData);
            setSelectedRoute(null);
            const topoLayer = layerManagerRef.current?.getLayer('topology');
            if (topoLayer instanceof TopoLayer) {
              topoLayer.setSelectedPoint(pointData);
              topoLayer.setSelectedRoute(null);
            }
            return;
          }
        }
        obj = obj.parent as THREE.Object3D;
      }
    }

    if (currentTool === 'addPoint') {
      // 添加点位工具：点击空白区域添加新点位
      const worldPos = getWorldPosition(event);
      if (!worldPos) return;

      // 生成唯一的点位名称
      const mapManager = mapManagerRef.current;
      const existingPoints = mapManager.getTopologyPoints();
      let pointIndex = existingPoints.length;
      let pointName = `NAV_POINT_${pointIndex}`;
      while (existingPoints.some(p => p.name === pointName)) {
        pointIndex++;
        pointName = `NAV_POINT_${pointIndex}`;
      }

      // 添加新点位（默认没有连线）
      const newPoint: TopoPoint = {
        name: pointName,
        x: worldPos.x,
        y: worldPos.y,
        theta: 0,
        type: 0,
      };
      const command = new AddPointCommand(mapManager, newPoint, updateTopoMap);
      commandManagerRef.current.executeCommand(command);
      setSelectedPoint(newPoint);
      const topoLayer = layerManagerRef.current?.getLayer('topology');
      if (topoLayer instanceof TopoLayer) {
        topoLayer.setSelectedPoint(newPoint);
      }
      toast.success(`已添加点位: ${pointName}`);
    }
  };

  const handleCanvasMouseDown = (event: MouseEvent) => {
    if ((currentTool === 'brush' || currentTool === 'eraser') && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      const worldPos = getWorldPosition(event);
      if (worldPos && occupancyGridLayerRef.current) {
        setIsDrawing(true);
        lastDrawPosRef.current = worldPos;
        currentGridChangesRef.current.clear();
        initialGridValuesRef.current.clear();

        const value = currentTool === 'brush' ? 100 : 0;
        const changes = occupancyGridLayerRef.current.modifyCells([{ x: worldPos.x, y: worldPos.y }], value, brushSize);

        for (const change of changes) {
          initialGridValuesRef.current.set(change.index, change.oldValue);
          currentGridChangesRef.current.set(change.index, { oldValue: change.oldValue, newValue: change.newValue });
        }

        // 禁用 controls
        if (controlsRef.current) {
          controlsRef.current.enablePan = false;
        }
      }
      return;
    }

    if (currentTool === 'move') {
      if (event.button === 0) {
        // 左键：移动点位
        const rect = canvasRef.current!.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current!.setFromCamera(mouse, cameraRef.current!);
        const intersects = raycasterRef.current!.intersectObjects(sceneRef.current!.children, true);

        for (const intersect of intersects) {
          let obj = intersect.object;
          while (obj) {
            if (obj.userData.isTopoPoint && obj.userData.topoPoint) {
              const point = obj.userData.topoPoint;
              const mapManager = mapManagerRef.current;
              const pointData = mapManager.getTopologyPoint(point.name);
              if (pointData) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedPoint(pointData);
                setIsDragging(true);
                setDragStartPos(new THREE.Vector2(event.clientX, event.clientY));
                dragStartPointRef.current = { ...pointData };

                // 禁用 controls
                if (controlsRef.current) {
                  controlsRef.current.enablePan = false;
                }

                // 找到对应的 group
                sceneRef.current!.traverse((child) => {
                  if (child instanceof THREE.Group && child.name === point.name) {
                    selectedPointRef.current = child;
                  }
                });
              }
              return;
            }
            obj = obj.parent as THREE.Object3D;
          }
        }
      } else if (event.button === 2) {
        // 右键：旋转点位方向
        const rect = canvasRef.current!.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current!.setFromCamera(mouse, cameraRef.current!);
        const intersects = raycasterRef.current!.intersectObjects(sceneRef.current!.children, true);

        for (const intersect of intersects) {
          let obj = intersect.object;
          while (obj) {
            if (obj.userData.isTopoPoint && obj.userData.topoPoint) {
              const point = obj.userData.topoPoint;
              const mapManager = mapManagerRef.current;
              const pointData = mapManager.getTopologyPoint(point.name);
              if (pointData) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedPoint(pointData);
                setIsRotating(true);
                setDragStartPos(new THREE.Vector2(event.clientX, event.clientY));
                dragStartPointRef.current = { ...pointData };

                // 禁用 controls
                if (controlsRef.current) {
                  controlsRef.current.enablePan = false;
                }

                // 找到对应的 group
                sceneRef.current!.traverse((child) => {
                  if (child instanceof THREE.Group && child.name === point.name) {
                    selectedPointRef.current = child;
                  }
                });
              }
              return;
            }
            obj = obj.parent as THREE.Object3D;
          }
        }
      }
    }
  };

  const updateBrushIndicatorFromNative = (event: MouseEvent) => {
    if ((currentTool === 'eraser' || currentTool === 'brush') && canvasRef.current && cameraRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setMousePosition({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    } else {
      setMousePosition(null);
    }
  };

  const updateBrushIndicator = (event: React.MouseEvent<HTMLCanvasElement>) => {
    updateBrushIndicatorFromNative(event.nativeEvent);
  };

  const getBrushIndicatorSize = (): number => {
    if (!cameraRef.current || !canvasRef.current) return 0;

    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    const distance = camera.position.z;
    const fov = camera.fov * (Math.PI / 180);
    const canvasHeight = canvas.clientHeight;
    const worldHeight = 2 * Math.tan(fov / 2) * distance;
    const pixelsPerMeter = canvasHeight / worldHeight;

    return brushSize * pixelsPerMeter;
  };

  const handleCanvasMouseMove = (event: MouseEvent) => {
    updateBrushIndicatorFromNative(event);

    const worldPos = getWorldPosition(event);
    if (worldPos) {
      setMouseWorldPos({ x: worldPos.x, y: worldPos.y });
    }

    if (isDrawing && (currentTool === 'brush' || currentTool === 'eraser') && occupancyGridLayerRef.current) {
      event.preventDefault();
      event.stopPropagation();
      const worldPos = getWorldPosition(event);
      if (worldPos) {
        const value = currentTool === 'brush' ? 100 : 0;
        const positions: Array<{ x: number; y: number }> = [];

        if (lastDrawPosRef.current) {
          const dx = worldPos.x - lastDrawPosRef.current.x;
          const dy = worldPos.y - lastDrawPosRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.max(1, Math.ceil(dist / (brushSize / 4)));

          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            positions.push({
              x: lastDrawPosRef.current.x + dx * t,
              y: lastDrawPosRef.current.y + dy * t,
            });
          }
        } else {
          positions.push({ x: worldPos.x, y: worldPos.y });
        }

        const changes = occupancyGridLayerRef.current.modifyCells(positions, value, brushSize, initialGridValuesRef.current);

        for (const change of changes) {
          if (!currentGridChangesRef.current.has(change.index)) {
            if (!initialGridValuesRef.current.has(change.index)) {
              initialGridValuesRef.current.set(change.index, change.oldValue);
            }
            currentGridChangesRef.current.set(change.index, { oldValue: change.oldValue, newValue: change.newValue });
          } else {
            const existing = currentGridChangesRef.current.get(change.index)!;
            existing.newValue = change.newValue;
          }
        }

        lastDrawPosRef.current = worldPos;
      }
      return;
    }

    if (isRotating && selectedPoint && dragStartPos && selectedPointRef.current) {
      // 右键拖动：旋转点位方向
      event.preventDefault();
      event.stopPropagation();

      const worldPos = getWorldPosition(event);
      if (worldPos && selectedPointRef.current) {
        const dx = worldPos.x - selectedPoint.x;
        const dy = worldPos.y - selectedPoint.y;
        const theta = -Math.atan2(dy, dx);
        const updatedPoint: TopoPoint = {
          ...selectedPoint,
          theta: theta,
        };
        mapManagerRef.current.setTopologyPoint(updatedPoint);
        setSelectedPoint(updatedPoint);
        updateTopoMap();
      }
    } else if (isDragging && selectedPoint && dragStartPos && selectedPointRef.current) {
      event.preventDefault();
      event.stopPropagation();

      // 左键拖动：移动位置
      const worldPos = getWorldPosition(event);
      if (worldPos) {
        const updatedPoint: TopoPoint = {
          ...selectedPoint,
          x: worldPos.x,
          y: worldPos.y,
        };
        mapManagerRef.current.setTopologyPoint(updatedPoint);
        setSelectedPoint(updatedPoint);
        updateTopoMap();
      }
    } else if (currentTool === 'addRoute' && routeStartPoint) {
      // 更新预览线段（拓扑连线）
      updatePreviewLine(event);
    } else if (currentTool === 'drawLine' && lineStartPoint) {
      // 更新预览线段（直线绘制）
      updatePreviewLine(event);
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDrawing && (currentTool === 'brush' || currentTool === 'eraser')) {
      if (currentGridChangesRef.current.size > 0) {
        const changes: GridCellChange[] = Array.from(currentGridChangesRef.current.entries()).map(([index, values]) => ({
          index,
          oldValue: values.oldValue,
          newValue: values.newValue,
        }));

        const command = new ModifyGridCommand(
          occupancyGridLayerRef.current,
          changes,
          () => { }
        );
        commandManagerRef.current.executeCommand(command);
        currentGridChangesRef.current.clear();
      }
      setIsDrawing(false);
      lastDrawPosRef.current = null;
    }

    if ((isDragging || isRotating) && selectedPoint && dragStartPointRef.current) {
      const currentPoint = mapManagerRef.current.getTopologyPoint(selectedPoint.name);
      if (currentPoint && dragStartPointRef.current.name === currentPoint.name) {
        const command = new ModifyPointCommand(mapManagerRef.current, dragStartPointRef.current, currentPoint, updateTopoMap);
        commandManagerRef.current.executeCommand(command);
      }
      dragStartPointRef.current = null;
    }

    setIsDragging(false);
    setIsRotating(false);
    setDragStartPos(null);
    selectedPointRef.current = null;

    // 恢复 controls
    if (controlsRef.current) {
      controlsRef.current.enablePan = true;
    }
  };

  const createPreviewLine = (startX: number, startY: number, endX: number, endY: number) => {
    if (!sceneRef.current) return;

    clearPreviewLine();

    const geometry = new THREE.BufferGeometry();
    const pointHeight = 0.2 * 2;
    const lineZ = 0.002 + pointHeight / 2;
    const positions = new Float32Array([
      startX,
      startY,
      lineZ,
      endX,
      endY,
      lineZ,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: currentTool === 'drawLine' ? 0x2196f3 : 0x00ff00,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
    });

    const line = new THREE.Line(geometry, material);
    line.name = 'previewLine';
    previewLineRef.current = line;
    sceneRef.current.add(line);
  };

  const updatePreviewLine = (event: MouseEvent) => {
    if (!sceneRef.current) return;

    if (currentTool === 'drawLine' && lineStartPoint) {
      const worldPos = getWorldPosition(event);
      if (!worldPos) return;

      if (!previewLineRef.current) {
        createPreviewLine(lineStartPoint.x, lineStartPoint.y, worldPos.x, worldPos.y);
        return;
      }

      const geometry = previewLineRef.current.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position.array as Float32Array;
      const pointHeight = 0.2 * 2;
      const lineZ = 0.002 + pointHeight / 2;

      positions[0] = lineStartPoint.x;
      positions[1] = lineStartPoint.y;
      positions[2] = lineZ;
      positions[3] = worldPos.x;
      positions[4] = worldPos.y;
      positions[5] = lineZ;

      geometry.attributes.position.needsUpdate = true;
    } else if (currentTool === 'addRoute' && routeStartPoint) {
      const mapManager = mapManagerRef.current;
      const startPoint = mapManager.getTopologyPoint(routeStartPoint);
      if (!startPoint) return;

      const worldPos = getWorldPosition(event);
      if (!worldPos) return;

      if (!previewLineRef.current) {
        createPreviewLine(startPoint.x, startPoint.y, worldPos.x, worldPos.y);
        return;
      }

      const geometry = previewLineRef.current.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position.array as Float32Array;
      const pointHeight = 0.2 * 2;
      const lineZ = 0.002 + pointHeight / 2;

      positions[0] = startPoint.x;
      positions[1] = startPoint.y;
      positions[2] = lineZ;
      positions[3] = worldPos.x;
      positions[4] = worldPos.y;
      positions[5] = lineZ;

      geometry.attributes.position.needsUpdate = true;
    }
  };

  const clearPreviewLine = () => {
    if (previewLineRef.current && sceneRef.current) {
      sceneRef.current.remove(previewLineRef.current);
      previewLineRef.current.geometry.dispose();
      (previewLineRef.current.material as THREE.Material).dispose();
      previewLineRef.current = null;
    }
  };

  const updateTopoMap = () => {
    const mapManager = mapManagerRef.current;
    const topologyMap = mapManager.getTopologyMap();

    const mapProperty = mapManager.getMapProperty();
    const defaultControllers = ['FollowPath'];
    const defaultGoalCheckers = ['general_goal_checker'];

    const allControllers = new Set<string>(defaultControllers);
    const allGoalCheckers = new Set<string>(defaultGoalCheckers);

    if (mapProperty) {
      if (mapProperty.support_controllers) {
        mapProperty.support_controllers.forEach(c => allControllers.add(c));
      }
      if (mapProperty.support_goal_checkers) {
        mapProperty.support_goal_checkers.forEach(g => allGoalCheckers.add(g));
      }
    }

    const routes = mapManager.getTopologyRoutes();
    routes.forEach(route => {
      if (route.route_info.controller) {
        allControllers.add(route.route_info.controller);
      }
      if (route.route_info.goal_checker) {
        allGoalCheckers.add(route.route_info.goal_checker);
      }
    });

    if (selectedRoute) {
      if (selectedRoute.route_info.controller) {
        allControllers.add(selectedRoute.route_info.controller);
      }
      if (selectedRoute.route_info.goal_checker) {
        allGoalCheckers.add(selectedRoute.route_info.goal_checker);
      }
    }

    setSupportControllers(Array.from(allControllers).sort());
    setSupportGoalCheckers(Array.from(allGoalCheckers).sort());

    if (topoLayerRef.current) {
      topoLayerRef.current.update(topologyMap);
      // 更新后恢复选中状态
      const currentSelectedPoint = selectedPointStateRef.current;
      const currentSelectedRoute = selectedRouteStateRef.current;
      if (currentSelectedPoint) {
        const currentPoint = mapManager.getTopologyPoint(currentSelectedPoint.name);
        if (currentPoint) {
          topoLayerRef.current.setSelectedPoint(currentPoint);
        }
      }
      if (currentSelectedRoute) {
        topoLayerRef.current.setSelectedRoute(currentSelectedRoute);
      }
    }
  };

  const handleSave = () => {
    const mapManager = mapManagerRef.current;

    const defaultControllers = ['FollowPath'];
    const defaultGoalCheckers = ['general_goal_checker'];

    const allControllers = new Set<string>(defaultControllers);
    const allGoalCheckers = new Set<string>(defaultGoalCheckers);

    const existingMapProperty = mapManager.getMapProperty();
    if (existingMapProperty) {
      if (existingMapProperty.support_controllers) {
        existingMapProperty.support_controllers.forEach(c => allControllers.add(c));
      }
      if (existingMapProperty.support_goal_checkers) {
        existingMapProperty.support_goal_checkers.forEach(g => allGoalCheckers.add(g));
      }
    }

    const routes = mapManager.getTopologyRoutes();
    routes.forEach(route => {
      if (route.route_info.controller) {
        allControllers.add(route.route_info.controller);
      }
      if (route.route_info.goal_checker) {
        allGoalCheckers.add(route.route_info.goal_checker);
      }
    });

    const mapProperty = {
      support_controllers: Array.from(allControllers).sort(),
      support_goal_checkers: Array.from(allGoalCheckers).sort(),
    };

    mapManager.updateMapProperty(mapProperty);

    try {
      mapManager.saveAndPublishTopology(connection);
      toast.success('拓扑地图已保存并发布');
    } catch (error) {
      console.error('Failed to save/publish topology map:', error);
      mapManager.saveTopology();
      toast.warning('保存成功，但发布失败');
    }

    try {
      mapManagerRef.current.publishOccupancyGrid(connection);
      toast.success('栅格地图已发布到 /map/update');
    } catch (error) {
      console.error('Failed to publish occupancy grid:', error);
      toast.warning('栅格地图发布失败');
    }
  };

  useEffect(() => {
    selectedPointStateRef.current = selectedPoint;
  }, [selectedPoint]);

  useEffect(() => {
    selectedRouteStateRef.current = selectedRoute;
  }, [selectedRoute]);

  useEffect(() => {
    if (selectedPoint) {
      setEditingPoint({ ...selectedPoint });
    } else {
      setEditingPoint(null);
    }
  }, [selectedPoint]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          if (commandManagerRef.current.redo()) {
            toast.success('重做');
          }
        } else {
          if (commandManagerRef.current.undo()) {
            toast.success('撤销');
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clickHandler = (e: MouseEvent) => handleCanvasClick(e);
    const mouseDownHandler = (e: MouseEvent) => handleCanvasMouseDown(e);
    const mouseMoveHandler = (e: MouseEvent) => handleCanvasMouseMove(e);
    const mouseUpHandler = () => handleCanvasMouseUp();
    const mouseLeaveHandler = () => setMouseWorldPos(null);

    canvas.addEventListener('click', clickHandler);
    canvas.addEventListener('mousedown', mouseDownHandler);
    canvas.addEventListener('mousemove', mouseMoveHandler);
    canvas.addEventListener('mouseup', mouseUpHandler);
    canvas.addEventListener('mouseleave', mouseLeaveHandler);

    return () => {
      canvas.removeEventListener('click', clickHandler);
      canvas.removeEventListener('mousedown', mouseDownHandler);
      canvas.removeEventListener('mousemove', mouseMoveHandler);
      canvas.removeEventListener('mouseup', mouseUpHandler);
      canvas.removeEventListener('mouseleave', mouseLeaveHandler);
    };
  }, [currentTool, isDragging, isRotating, selectedPoint, routeStartPoint, lineStartPoint, isDrawing, brushSize]);

  const handlePointPropertyChange = (field: keyof TopoPoint, value: string | number) => {
    if (!selectedPoint) return;

    const oldPoint = { ...selectedPoint };
    const updatedPoint: TopoPoint = {
      ...selectedPoint,
      [field]: value,
    };
    const command = new ModifyPointCommand(mapManagerRef.current, oldPoint, updatedPoint, updateTopoMap);
    commandManagerRef.current.executeCommand(command);
    setSelectedPoint(updatedPoint);
    const topoLayer = layerManagerRef.current?.getLayer('topology');
    if (topoLayer instanceof TopoLayer) {
      topoLayer.setSelectedPoint(updatedPoint);
    }
  };

  const handleRoutePropertyChange = (field: keyof RouteInfo, value: string | number) => {
    if (!selectedRoute) return;

    if (field === 'controller' && typeof value === 'string') {
      if (!supportControllers.includes(value)) {
        setSupportControllers([...supportControllers, value]);
      }
    } else if (field === 'goal_checker' && typeof value === 'string') {
      if (!supportGoalCheckers.includes(value)) {
        setSupportGoalCheckers([...supportGoalCheckers, value]);
      }
    }

    const oldRoute = { ...selectedRoute };
    const updatedRoute: Route = {
      ...selectedRoute,
      route_info: {
        ...selectedRoute.route_info,
        [field]: value,
      },
    };
    const command = new ModifyRouteCommand(mapManagerRef.current, oldRoute, updatedRoute, updateTopoMap);
    commandManagerRef.current.executeCommand(command);
    setSelectedRoute(updatedRoute);
  };

  const handleAddRobotPosition = () => {
    const tf2js = TF2JS.getInstance();
    const mapFrame = 'map';
    const baseFrame = 'base_link';
    const transform = tf2js.findTransform(mapFrame, baseFrame);

    if (!transform) {
      toast.error('无法获取机器人位置，请检查TF连接');
      return;
    }

    const robotEuler = new THREE.Euler();
    robotEuler.setFromQuaternion(transform.rotation, 'XYZ');
    const robotTheta = robotEuler.z;

    const mapManager = mapManagerRef.current;
    const existingPoints = mapManager.getTopologyPoints();
    let pointIndex = existingPoints.length;
    let pointName = `NAV_POINT_${pointIndex}`;
    while (existingPoints.some(p => p.name === pointName)) {
      pointIndex++;
      pointName = `NAV_POINT_${pointIndex}`;
    }

    const newPoint: TopoPoint = {
      name: pointName,
      x: transform.translation.x,
      y: transform.translation.y,
      theta: robotTheta,
      type: 0,
    };

    const command = new AddPointCommand(mapManager, newPoint, updateTopoMap);
    commandManagerRef.current.executeCommand(command);
    setSelectedPoint(newPoint);
    const topoLayer = layerManagerRef.current?.getLayer('topology');
    if (topoLayer instanceof TopoLayer) {
      topoLayer.setSelectedPoint(newPoint);
    }
    toast.success(`已添加机器人当前位置为导航点: ${pointName}`);
  };

  const handleExportMap = () => {
    setShowExportDialog(true);
    setExportMapName('map');
  };

  const handleExportConfirm = async () => {
    if (!exportMapName.trim()) {
      toast.error('请输入地图名称');
      return;
    }

    try {
      const occupancyGrid = occupancyGridLayerRef.current?.getMapMessage();
      const topologyMap = mapManagerRef.current.getTopologyMap();

      if (!occupancyGrid && (!topologyMap.points || topologyMap.points.length === 0)) {
        toast.error('没有可导出的地图数据');
        return;
      }

      await exportMap(
        occupancyGrid || null,
        (topologyMap.points && topologyMap.points.length > 0) ? topologyMap : null,
        exportMapName.trim()
      );
      toast.success(`地图已导出为 ${exportMapName.trim()}.zip`);
      setShowExportDialog(false);
      setExportMapName('');
    } catch (error) {
      console.error('导出地图失败:', error);
      toast.error('导出地图失败');
    }
  };

  const handleImportMap = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      toast.error('请选择zip格式的地图文件');
      return;
    }

    try {
      const { occupancyGrid, topologyMap } = await importMap(file);

      if (occupancyGrid) {
        console.log('[MapEditor] Importing occupancy grid', {
          hasInfo: !!occupancyGrid.info,
          hasData: !!occupancyGrid.data,
          width: occupancyGrid.info?.width,
          height: occupancyGrid.info?.height,
          dataLength: occupancyGrid.data?.length
        });
        mapManagerRef.current.updateOccupancyGrid(occupancyGrid, true);

        const timeoutId = setTimeout(() => {
          const layer = occupancyGridLayerRef.current;
          if (layer && 'renderMap' in layer) {
            const currentMap = mapManagerRef.current.getOccupancyGrid();
            console.log('[MapEditor] Manually triggering render after import', {
              hasMap: !!currentMap,
              hasLayer: !!layer
            });
            if (currentMap && layer instanceof OccupancyGridLayer) {
              layer.renderMap(currentMap);
            }
          }
          timeoutRefsRef.current.delete(timeoutId);
        }, 100);
        timeoutRefsRef.current.add(timeoutId);

        toast.success('栅格地图导入成功');
      }

      if (topologyMap && topologyMap.points && topologyMap.points.length > 0) {
        const mapManager = mapManagerRef.current;
        mapManager.updateTopologyMap(topologyMap, false);
        updateTopoMap();
        toast.success('拓扑地图导入成功');
      }

      if (!occupancyGrid && (!topologyMap || !topologyMap.points || topologyMap.points.length === 0)) {
        toast.warning('zip文件中没有找到有效的地图数据');
      }
    } catch (error) {
      console.error('导入地图失败:', error);
      toast.error('导入地图失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleEditingPointChange = (field: keyof TopoPoint, value: string | number) => {
    if (!editingPoint) return;
    setEditingPoint({
      ...editingPoint,
      [field]: value,
    });
  };

  const handlePointConfirm = () => {
    if (!editingPoint || !selectedPoint) return;

    const oldPoint = { ...selectedPoint };
    const command = new ModifyPointCommand(mapManagerRef.current, oldPoint, editingPoint, updateTopoMap);
    commandManagerRef.current.executeCommand(command);
    setSelectedPoint(null);
    setEditingPoint(null);
    const topoLayer = layerManagerRef.current?.getLayer('topology');
    if (topoLayer instanceof TopoLayer) {
      topoLayer.setSelectedPoint(null);
    }
  };

  const handlePointCancel = () => {
    setSelectedPoint(null);
    setEditingPoint(null);
    const topoLayer = layerManagerRef.current?.getLayer('topology');
    if (topoLayer instanceof TopoLayer) {
      topoLayer.setSelectedPoint(null);
    }
  };

  const handleFillRobotPosition = () => {
    if (!editingPoint || !robotPos) {
      toast.error('无法获取机器人位置，请检查TF连接');
      return;
    }

    setEditingPoint({
      ...editingPoint,
      x: robotPos.x,
      y: robotPos.y,
      theta: robotPos.theta,
    });
  };

  return (
    <div className="MapEditor">
      <div className="EditorHeader">
        <h2>地图编辑</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="SaveButton"
            onClick={handleImportMap}
            type="button"
            style={{
              padding: '8px 16px',
              backgroundColor: '#FF9800',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            title="导入地图zip文件"
          >
            📥 导入地图
          </button>
          <button
            className="SaveButton"
            onClick={handleExportMap}
            type="button"
            style={{
              padding: '8px 16px',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            title="导出地图为map.zip"
          >
            📦 导出地图
          </button>
          <button
            className="SaveButton"
            onClick={handleSave}
            type="button"
            style={{
              padding: '8px 16px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            title="保存拓扑地图"
          >
            💾 保存
          </button>
          <button className="CloseButton" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>
      <div className="EditorContent">
        <div className="Toolbar">
          <button
              className={`ToolButton ${currentTool === 'move' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('move');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="移动工具"
            >
              🖱️ 移动
            </button>
            <button
              className={`ToolButton ${currentTool === 'addPoint' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('addPoint');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="添加拓扑点位"
            >
              ➕ 添加点位
            </button>
            <button
              className={`ToolButton ${currentTool === 'addRoute' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('addRoute');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="拓扑连线"
            >
              🔗 拓扑路径
            </button>
            <button
              className={`ToolButton ${currentTool === 'brush' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('brush');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="绘制障碍物"
            >
              🖌️ 障碍物绘制
            </button>
            <button
              className={`ToolButton ${currentTool === 'eraser' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('eraser');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="擦除障碍物"
            >
              🧹 橡皮擦
            </button>
            <button
              className={`ToolButton ${currentTool === 'drawLine' ? 'active' : ''}`}
              onClick={() => {
                setCurrentTool('drawLine');
                setRouteStartPoint(null);
                setLineStartPoint(null);
                clearPreviewLine();
                setMousePosition(null);
              }}
              type="button"
              title="直线绘制"
            >
              📏 直线绘制
            </button>
        </div>
        {(currentTool === 'brush' || currentTool === 'eraser' || currentTool === 'drawLine') && (
          <div className="ToolbarOptions" style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'white' }}>
              <span style={{ color: 'white' }}>画笔大小:</span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={brushSize}
                onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '40px', textAlign: 'right', color: 'white' }}>{brushSize.toFixed(2)}m</span>
            </label>
          </div>
        )}
        {currentTool === 'addPoint' && (
          <div className="ToolbarOptions">
            <button
              onClick={handleAddRobotPosition}
              type="button"
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
              title="将机器人当前位置添加为导航点位"
            >
              🤖 添加机器人当前位置
            </button>
          </div>
        )}
        <div className="EditorCanvas">
          <canvas
            ref={canvasRef}
            className={`EditorMapCanvas ${currentTool === 'brush' ? 'cursor-brush' :
                currentTool === 'eraser' ? 'cursor-eraser' :
                  ''
              }`}
            onMouseMove={updateBrushIndicator}
            onMouseLeave={() => setMousePosition(null)}
            onContextMenu={(e) => {
              if (currentTool === 'move') {
                e.preventDefault();
              }
            }}
          />
          {(currentTool === 'eraser' || currentTool === 'brush') && mousePosition && (
            <div
              ref={brushIndicatorRef}
              className={`BrushIndicator ${currentTool === 'brush' ? 'BrushIndicator-brush' : 'BrushIndicator-eraser'}`}
              style={{
                left: `${mousePosition.x}px`,
                top: `${mousePosition.y}px`,
                width: `${getBrushIndicatorSize()}px`,
                height: `${getBrushIndicatorSize()}px`,
                marginLeft: `-${getBrushIndicatorSize() / 2}px`,
                marginTop: `-${getBrushIndicatorSize() / 2}px`,
              }}
            />
          )}
        </div>
        {((selectedPoint && editingPoint) || selectedRoute) && (
          <div className="PropertyPanel">
            {selectedPoint && editingPoint && (
              <div className="PropertySection">
                <h3>点位属性</h3>
                <div className="PropertyRow">
                  <label>名称:</label>
                  <input
                    type="text"
                    value={editingPoint.name}
                    onChange={(e) => handleEditingPointChange('name', e.target.value)}
                  />
                </div>
                <div className="PropertyRow">
                  <label>X:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingPoint.x}
                    onChange={(e) => handleEditingPointChange('x', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="PropertyRow">
                  <label>Y:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingPoint.y}
                    onChange={(e) => handleEditingPointChange('y', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="PropertyRow">
                  <label>Theta:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingPoint.theta}
                    onChange={(e) => handleEditingPointChange('theta', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <button
                  onClick={handleFillRobotPosition}
                  type="button"
                  style={{
                    width: '100%',
                    padding: '8px 16px',
                    marginBottom: '10px',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                  title="将机器人当前位置填入坐标"
                >
                  🤖 填入机器人位置
                </button>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <button
                    onClick={handlePointConfirm}
                    type="button"
                    style={{
                      flex: 1,
                      padding: '8px 16px',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    确定
                  </button>
                  <button
                    onClick={handlePointCancel}
                    type="button"
                    style={{
                      flex: 1,
                      padding: '8px 16px',
                      backgroundColor: '#555',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    取消
                  </button>
                </div>
                <button
                  className="DeleteButton"
                  onClick={() => {
                    const command = new DeletePointCommand(mapManagerRef.current, selectedPoint, updateTopoMap);
                    commandManagerRef.current.executeCommand(command);
                    setSelectedPoint(null);
                    setEditingPoint(null);
                    const topoLayer = layerManagerRef.current?.getLayer('topology');
                    if (topoLayer instanceof TopoLayer) {
                      topoLayer.setSelectedPoint(null);
                    }
                    toast.success(`已删除点位: ${selectedPoint.name}`);
                  }}
                  type="button"
                >
                  删除点位
                </button>
              </div>
            )}
            {selectedRoute && (
              <div className="PropertySection">
                <h3>路线属性</h3>
                <div className="PropertyRow">
                  <label>起点:</label>
                  <span>{selectedRoute.from_point}</span>
                </div>
                <div className="PropertyRow">
                  <label>终点:</label>
                  <span>{selectedRoute.to_point}</span>
                </div>
                <div className="PropertyRow">
                  <label>控制器:</label>
                  <select
                    value={selectedRoute.route_info.controller}
                    onChange={(e) => handleRoutePropertyChange('controller', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      backgroundColor: '#1a1a1a',
                      color: 'white',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                  >
                    {supportControllers.map(controller => (
                      <option key={controller} value={controller}>{controller}</option>
                    ))}
                  </select>
                </div>
                <div className="PropertyRow">
                  <label>目标检查器:</label>
                  <select
                    value={selectedRoute.route_info.goal_checker}
                    onChange={(e) => handleRoutePropertyChange('goal_checker', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      backgroundColor: '#1a1a1a',
                      color: 'white',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                  >
                    {supportGoalCheckers.map(goalChecker => (
                      <option key={goalChecker} value={goalChecker}>{goalChecker}</option>
                    ))}
                  </select>
                </div>
                <div className="PropertyRow">
                  <label>速度限制:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedRoute.route_info.speed_limit}
                    onChange={(e) => handleRoutePropertyChange('speed_limit', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <button
                  className="DeleteButton"
                  onClick={() => {
                    const command = new DeleteRouteCommand(mapManagerRef.current, selectedRoute, updateTopoMap);
                    commandManagerRef.current.executeCommand(command);
                    setSelectedRoute(null);
                    const topoLayer = layerManagerRef.current?.getLayer('topology');
                    if (topoLayer instanceof TopoLayer) {
                      topoLayer.setSelectedRoute(null);
                    }
                    toast.success(`已删除路线: ${selectedRoute.from_point} -> ${selectedRoute.to_point}`);
                  }}
                  type="button"
                >
                  删除路线
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {showExportDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
        }}>
          <div style={{
            backgroundColor: '#2a2a2a',
            padding: '20px',
            borderRadius: '8px',
            minWidth: '300px',
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px', color: 'white' }}>导出地图</h3>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: 'white' }}>
                地图名称:
              </label>
              <input
                type="text"
                value={exportMapName}
                onChange={(e) => setExportMapName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleExportConfirm();
                  } else if (e.key === 'Escape') {
                    setShowExportDialog(false);
                    setExportMapName('');
                  }
                }}
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: '#1a1a1a',
                  color: 'white',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                placeholder="例如: map"
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowExportDialog(false);
                  setExportMapName('');
                }}
                type="button"
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#555',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                取消
              </button>
              <button
                onClick={handleExportConfirm}
                type="button"
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                导出
              </button>
            </div>
          </div>
        </div>
      )}
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

