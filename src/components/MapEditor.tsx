import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toast } from 'react-toastify';
import { RosbridgeConnection } from '../utils/RosbridgeConnection';
import { TF2JS } from '../utils/tf2js';
import { LayerManager } from './layers/LayerManager';
import type { LayerConfigMap } from '../types/LayerConfig';
import { TopoLayer } from './layers/TopoLayer';
import { TopologyMapManager } from '../utils/TopologyMapManager';
import type { TopoPoint, Route, RouteInfo, TopologyMap } from '../utils/TopologyMapManager';
import './MapEditor.css';

interface MapEditorProps {
  connection: RosbridgeConnection;
  onClose: () => void;
}

type EditTool = 'move' | 'addPoint' | 'addRoute';

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
  const [currentTool, setCurrentTool] = useState<EditTool>('move');
  const [selectedPoint, setSelectedPoint] = useState<TopoPoint | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<THREE.Vector2 | null>(null);
  const [routeStartPoint, setRouteStartPoint] = useState<string | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const mapManagerRef = useRef<TopologyMapManager>(TopologyMapManager.getInstance());
  const selectedPointRef = useRef<THREE.Group | null>(null);
  const previewLineRef = useRef<THREE.Line | null>(null);
  const selectedPointStateRef = useRef<TopoPoint | null>(null);
  const selectedRouteStateRef = useRef<Route | null>(null);

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
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 1000;
    controls.target.set(0, 0, 0);
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    (controls as any).zoomToCursor = true;
    
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
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
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

    const initializeAndSubscribe = async () => {
      try {
        await connection.initializeMessageReaders();
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(DEFAULT_EDITOR_CONFIGS);
        
        // 初始化 MapManager
        const mapManager = mapManagerRef.current;
        mapManager.initialize(connection);
        
        // 监听地图更新
        const handleMapUpdate = (_map: TopologyMap) => {
          updateTopoMap();
        };
        mapManager.addListener(handleMapUpdate);
        
        // 获取 topology layer 引用
        setTimeout(() => {
          const topoLayer = layerManagerRef.current?.getLayer('topology') as TopoLayer | undefined;
          if (topoLayer) {
            topoLayerRef.current = topoLayer;
            // 同步 MapManager 的数据到图层
            updateTopoMap();
          }
        }, 500);
        
        return () => {
          mapManager.removeListener(handleMapUpdate);
        };
      } catch (error) {
        console.error('Failed to initialize message readers:', error);
        toast.error('初始化失败，使用默认配置...');
        TF2JS.getInstance().initialize(connection);
        layerManagerRef.current?.setLayerConfigs(DEFAULT_EDITOR_CONFIGS);
      }
    };

    void initializeAndSubscribe();

    return () => {
      TF2JS.getInstance().disconnect();
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
    if (!sceneRef.current || !cameraRef.current || isDragging) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current!.setFromCamera(mouse, cameraRef.current);
    const intersects = raycasterRef.current!.intersectObjects(sceneRef.current.children, true);

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
              createPreviewLine(point.name);
            } else if (routeStartPoint !== point.name) {
              // 检查是否已存在相同方向的路线（A->B 和 B->A 是不同的路线）
              const mapManager = mapManagerRef.current;
              const exists = mapManager.getRoutes().some(
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
                mapManager.setRoute(newRoute);
                updateTopoMap();
                setRouteStartPoint(null);
                setSelectedRoute(newRoute);
                setSelectedPoint(null);
                const topoLayer = layerManagerRef.current?.getLayer('topology');
                if (topoLayer && 'setSelectedRoute' in topoLayer) {
                  (topoLayer as any).setSelectedRoute(newRoute);
                }
                if (topoLayer && 'setSelectedPoint' in topoLayer) {
                  (topoLayer as any).setSelectedPoint(null);
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
      if (topoLayer && 'setSelectedPoint' in topoLayer) {
        (topoLayer as any).setSelectedPoint(null);
      }
      if (topoLayer && 'setSelectedRoute' in topoLayer) {
        (topoLayer as any).setSelectedRoute(null);
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
          if (topoLayer && 'setSelectedRoute' in topoLayer) {
            (topoLayer as any).setSelectedRoute(route);
          }
          if (topoLayer && 'setSelectedPoint' in topoLayer) {
            (topoLayer as any).setSelectedPoint(null);
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
          const pointData = mapManager.getPoint(point.name);
          if (pointData) {
            setSelectedPoint(pointData);
            setSelectedRoute(null);
            const topoLayer = layerManagerRef.current?.getLayer('topology');
            if (topoLayer && 'setSelectedPoint' in topoLayer) {
              (topoLayer as any).setSelectedPoint(pointData);
            }
            if (topoLayer && 'setSelectedRoute' in topoLayer) {
              (topoLayer as any).setSelectedRoute(null);
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
      const existingPoints = mapManager.getPoints();
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
      mapManager.setPoint(newPoint);
      updateTopoMap();
      setSelectedPoint(newPoint);
      const topoLayer = layerManagerRef.current?.getLayer('topology');
      if (topoLayer && 'setSelectedPoint' in topoLayer) {
        (topoLayer as any).setSelectedPoint(newPoint);
      }
      toast.success(`已添加点位: ${pointName}`);
    }
  };

  const handleCanvasMouseDown = (event: MouseEvent) => {
    if (currentTool === 'move' && event.button === 0) {
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
            const pointData = mapManager.getPoint(point.name);
            if (pointData) {
              event.preventDefault();
              event.stopPropagation();
              setSelectedPoint(pointData);
              setIsDragging(true);
              setDragStartPos(new THREE.Vector2(event.clientX, event.clientY));
              
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
  };

  const handleCanvasMouseMove = (event: MouseEvent) => {
    if (isDragging && selectedPoint && dragStartPos && selectedPointRef.current) {
      event.preventDefault();
      event.stopPropagation();
      
      if (event.shiftKey) {
        // Shift + 拖动：调整方向
        const worldPos = getWorldPosition(event);
        if (worldPos && selectedPointRef.current) {
          const dx = worldPos.x - selectedPoint.x;
          const dy = worldPos.y - selectedPoint.y;
          const theta = Math.atan2(dy, dx);
          const updatedPoint: TopoPoint = {
            ...selectedPoint,
            theta: theta,
          };
          mapManagerRef.current.setPoint(updatedPoint);
          setSelectedPoint(updatedPoint);
          updateTopoMap();
        }
      } else {
        // 普通拖动：移动位置
        const worldPos = getWorldPosition(event);
        if (worldPos) {
          const updatedPoint: TopoPoint = {
            ...selectedPoint,
            x: worldPos.x,
            y: worldPos.y,
          };
          mapManagerRef.current.setPoint(updatedPoint);
          setSelectedPoint(updatedPoint);
          updateTopoMap();
        }
      }
    } else if (currentTool === 'addRoute' && routeStartPoint) {
      // 更新预览线段
      updatePreviewLine(event);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    setDragStartPos(null);
    selectedPointRef.current = null;
    
    // 恢复 controls
    if (controlsRef.current) {
      controlsRef.current.enablePan = true;
    }
  };

  const createPreviewLine = (startPointName: string) => {
    if (!sceneRef.current) return;
    
    const mapManager = mapManagerRef.current;
    const startPoint = mapManager.getPoint(startPointName);
    if (!startPoint) return;
    
    clearPreviewLine();
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      startPoint.x,
      startPoint.y,
      0.002,
      startPoint.x,
      startPoint.y,
      0.002,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
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
    if (!previewLineRef.current || !routeStartPoint || !sceneRef.current) return;
    
    const mapManager = mapManagerRef.current;
    const startPoint = mapManager.getPoint(routeStartPoint);
    if (!startPoint) return;
    
    const worldPos = getWorldPosition(event);
    if (!worldPos) return;
    
    const geometry = previewLineRef.current.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position.array as Float32Array;
    
    const pointHeight = 0.2 * 2; // 使用默认 pointSize 0.2
    const lineZ = 0.002 + pointHeight / 2;
    
    positions[0] = startPoint.x;
    positions[1] = startPoint.y;
    positions[2] = lineZ;
    positions[3] = worldPos.x;
    positions[4] = worldPos.y;
    positions[5] = lineZ;
    
    geometry.attributes.position.needsUpdate = true;
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
    const topologyMap = mapManager.getMap();
    
    if (topoLayerRef.current) {
      (topoLayerRef.current as any).update(topologyMap);
      // 更新后恢复选中状态
      const currentSelectedPoint = selectedPointStateRef.current;
      const currentSelectedRoute = selectedRouteStateRef.current;
      if (currentSelectedPoint) {
        const currentPoint = mapManager.getPoint(currentSelectedPoint.name);
        if (currentPoint && 'setSelectedPoint' in topoLayerRef.current) {
          (topoLayerRef.current as any).setSelectedPoint(currentPoint);
        }
      }
      if (currentSelectedRoute && 'setSelectedRoute' in topoLayerRef.current) {
        (topoLayerRef.current as any).setSelectedRoute(currentSelectedRoute);
      }
    }
  };

  const handleSave = () => {
    const mapManager = mapManagerRef.current;
    try {
      mapManager.saveAndPublish(connection);
      toast.success('拓扑地图已保存并发布');
    } catch (error) {
      console.error('Failed to save/publish topology map:', error);
      mapManager.save();
      toast.warning('保存成功，但发布失败');
    }
  };

  useEffect(() => {
    selectedPointStateRef.current = selectedPoint;
  }, [selectedPoint]);

  useEffect(() => {
    selectedRouteStateRef.current = selectedRoute;
  }, [selectedRoute]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clickHandler = (e: MouseEvent) => handleCanvasClick(e);
    const mouseDownHandler = (e: MouseEvent) => handleCanvasMouseDown(e);
    const mouseMoveHandler = (e: MouseEvent) => handleCanvasMouseMove(e);
    const mouseUpHandler = () => handleCanvasMouseUp();

    canvas.addEventListener('click', clickHandler);
    canvas.addEventListener('mousedown', mouseDownHandler);
    canvas.addEventListener('mousemove', mouseMoveHandler);
    canvas.addEventListener('mouseup', mouseUpHandler);

    return () => {
      canvas.removeEventListener('click', clickHandler);
      canvas.removeEventListener('mousedown', mouseDownHandler);
      canvas.removeEventListener('mousemove', mouseMoveHandler);
      canvas.removeEventListener('mouseup', mouseUpHandler);
    };
  }, [currentTool, isDragging, selectedPoint, routeStartPoint]);

  const handlePointPropertyChange = (field: keyof TopoPoint, value: string | number) => {
    if (!selectedPoint) return;
    
    const updatedPoint: TopoPoint = {
      ...selectedPoint,
      [field]: value,
    };
    mapManagerRef.current.setPoint(updatedPoint);
    setSelectedPoint(updatedPoint);
    const topoLayer = layerManagerRef.current?.getLayer('topology');
    if (topoLayer && 'setSelectedPoint' in topoLayer) {
      (topoLayer as any).setSelectedPoint(updatedPoint);
    }
    updateTopoMap();
  };

  const handleRoutePropertyChange = (field: keyof RouteInfo, value: string | number) => {
    if (!selectedRoute) return;
    
    const updatedRoute: Route = {
      ...selectedRoute,
      route_info: {
        ...selectedRoute.route_info,
        [field]: value,
      },
    };
    mapManagerRef.current.setRoute(updatedRoute);
    setSelectedRoute(updatedRoute);
    updateTopoMap();
  };

  return (
    <div className="MapEditor">
      <div className="EditorHeader">
        <h2>地图编辑</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
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
      </div>
      <div className="EditorContent">
        <div className="Toolbar">
          <button
            className={`ToolButton ${currentTool === 'move' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTool('move');
              setRouteStartPoint(null);
              clearPreviewLine();
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
              clearPreviewLine();
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
              clearPreviewLine();
            }}
            type="button"
            title="拓扑连线"
          >
            🔗 连线
          </button>
        </div>
        <div className="EditorCanvas">
          <canvas ref={canvasRef} className="EditorMapCanvas" />
        </div>
        <div className="PropertyPanel">
          {selectedPoint && (
            <div className="PropertySection">
              <h3>点位属性</h3>
              <div className="PropertyRow">
                <label>名称:</label>
                <input
                  type="text"
                  value={selectedPoint.name}
                  onChange={(e) => handlePointPropertyChange('name', e.target.value)}
                />
              </div>
              <div className="PropertyRow">
                <label>X:</label>
                <input
                  type="number"
                  step="0.01"
                  value={selectedPoint.x.toFixed(3)}
                  onChange={(e) => handlePointPropertyChange('x', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="PropertyRow">
                <label>Y:</label>
                <input
                  type="number"
                  step="0.01"
                  value={selectedPoint.y.toFixed(3)}
                  onChange={(e) => handlePointPropertyChange('y', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="PropertyRow">
                <label>Theta:</label>
                <input
                  type="number"
                  step="0.01"
                  value={selectedPoint.theta.toFixed(3)}
                  onChange={(e) => handlePointPropertyChange('theta', parseFloat(e.target.value) || 0)}
                />
              </div>
              <button
                className="DeleteButton"
                onClick={() => {
                  mapManagerRef.current.deletePoint(selectedPoint.name);
                  setSelectedPoint(null);
                  const topoLayer = layerManagerRef.current?.getLayer('topology');
                  if (topoLayer && 'setSelectedPoint' in topoLayer) {
                    (topoLayer as any).setSelectedPoint(null);
                  }
                  updateTopoMap();
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
                <input
                  type="text"
                  value={selectedRoute.route_info.controller}
                  onChange={(e) => handleRoutePropertyChange('controller', e.target.value)}
                />
              </div>
              <div className="PropertyRow">
                <label>目标检查器:</label>
                <input
                  type="text"
                  value={selectedRoute.route_info.goal_checker}
                  onChange={(e) => handleRoutePropertyChange('goal_checker', e.target.value)}
                />
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
                  mapManagerRef.current.deleteRoute(selectedRoute);
                  setSelectedRoute(null);
                  const topoLayer = layerManagerRef.current?.getLayer('topology');
                  if (topoLayer && 'setSelectedRoute' in topoLayer) {
                    (topoLayer as any).setSelectedRoute(null);
                  }
                  updateTopoMap();
                  toast.success(`已删除路线: ${selectedRoute.from_point} -> ${selectedRoute.to_point}`);
                }}
                type="button"
              >
                删除路线
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

