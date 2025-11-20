import type { RosbridgeConnection } from './RosbridgeConnection';
import { saveTopologyMap, loadTopologyMap } from './topologyMapStorage';

export interface TopoPoint {
  name: string;
  x: number;
  y: number;
  theta: number;
  type: number;
}

export interface RouteInfo {
  controller: string;
  goal_checker: string;
  speed_limit: number;
}

export interface Route {
  from_point: string;
  to_point: string;
  route_info: RouteInfo;
}

export interface TopologyMap {
  map_name: string;
  map_property?: {
    support_controllers?: string[];
    support_goal_checkers?: string[];
  };
  points: TopoPoint[];
  routes?: Route[];
}

export interface OccupancyGrid {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  info: {
    map_load_time: {
      sec: number;
      nsec: number;
    };
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[] | Int8Array;
}

type TopologyMapUpdateListener = (map: TopologyMap) => void;
type OccupancyGridUpdateListener = (map: OccupancyGrid | null) => void;

export class MapManager {
  private static instance: MapManager | null = null;
  
  private points: Map<string, TopoPoint> = new Map();
  private routes: Route[] = [];
  private mapProperty: { support_controllers?: string[]; support_goal_checkers?: string[] } | undefined;
  private topologyListeners: Set<TopologyMapUpdateListener> = new Set();
  private occupancyGridListeners: Set<OccupancyGridUpdateListener> = new Set();
  private connection: RosbridgeConnection | null = null;
  private hasReceivedTopologyTopicMessage: boolean = false;
  private currentOccupancyGrid: OccupancyGrid | null = null;

  private constructor() {
    this.loadTopologyFromLocalStorage();
  }

  public static getInstance(): MapManager {
    if (!MapManager.instance) {
      MapManager.instance = new MapManager();
    }
    return MapManager.instance;
  }

  public initialize(connection: RosbridgeConnection): void {
    console.log('[MapManager] initialize called', { 
      hasConnection: !!connection, 
      isConnected: connection?.isConnected(),
      sameConnection: this.connection === connection 
    });
    
    if (this.connection === connection) {
      console.log('[MapManager] Same connection, skipping initialization');
      return;
    }
    
    this.connection = connection;
    
    if (connection.isConnected()) {
      console.log('[MapManager] Connection is connected, subscribing to topics');
      this.subscribeToTopics();
    } else {
      console.log('[MapManager] Connection is not connected yet');
    }
  }

  private subscribeToTopics(): void {
    if (!this.connection || !this.connection.isConnected()) {
      console.log('[MapManager] subscribeToTopics skipped: no connection or not connected');
      return;
    }

    console.log('[MapManager] subscribeToTopics: subscribing to topics');

    const topologyCallback = (message: unknown) => {
      const msg = message as TopologyMap;
      console.log('[MapManager] Received topology message', { 
        hasPoints: !!(msg.points && Array.isArray(msg.points)),
        pointsCount: msg.points?.length || 0 
      });
      if (msg.points && Array.isArray(msg.points)) {
        this.hasReceivedTopologyTopicMessage = true;
        this.updateTopologyFromMessage(msg);
      }
    };

    const occupancyGridCallback = (message: unknown) => {
      console.log('[MapManager] Raw message received:', message);
      const msg = message as any;
      
      let occupancyGrid: OccupancyGrid | null = null;
      
      if (msg && typeof msg === 'object') {
        if (msg.info && msg.data) {
          occupancyGrid = msg as OccupancyGrid;
        } else if (msg.map && msg.map.info && msg.map.data) {
          occupancyGrid = msg.map as OccupancyGrid;
        } else if (msg.header && msg.info && msg.data) {
          occupancyGrid = msg as OccupancyGrid;
        } else if (msg.bytes) {
          console.warn('[MapManager] Message has bytes but not parsed. This should not happen if MessageReader is working correctly.', {
            hasBytes: !!msg.bytes,
            bytesLength: msg.bytes?.length,
            messageType: msg.constructor?.name
          });
        }
      }
      
      console.log('[MapManager] Received occupancy grid message', { 
        messageKeys: Object.keys(msg || {}),
        hasInfo: !!occupancyGrid?.info, 
        hasData: !!occupancyGrid?.data,
        infoKeys: occupancyGrid?.info ? Object.keys(occupancyGrid.info) : [],
        width: occupancyGrid?.info?.width,
        height: occupancyGrid?.info?.height,
        dataLength: occupancyGrid?.data?.length,
        dataType: occupancyGrid?.data ? (Array.isArray(occupancyGrid.data) ? 'array' : occupancyGrid.data.constructor?.name) : 'none',
        messageType: msg?.constructor?.name,
        hasBytes: !!(msg as any)?.bytes
      });
      
      if (occupancyGrid && occupancyGrid.info && occupancyGrid.data) {
        this.updateOccupancyGrid(occupancyGrid, true);
      } else {
        console.warn('[MapManager] Message missing info or data', { 
          hasInfo: !!occupancyGrid?.info, 
          hasData: !!occupancyGrid?.data,
          msg: msg,
          messageType: msg?.constructor?.name
        });
      }
    };

    console.log('[MapManager] Subscribing to /map/topology');
    this.connection.subscribe('/map/topology', 'topology_msgs/msg/TopologyMap', topologyCallback);
    console.log('[MapManager] Subscribing to /map');
    this.connection.subscribe('/map', 'nav_msgs/OccupancyGrid', occupancyGridCallback);
  }

  private loadTopologyFromLocalStorage(): void {
    const savedMap = loadTopologyMap();
    if (savedMap && savedMap.points && Array.isArray(savedMap.points) && savedMap.points.length > 0) {
      this.updateTopologyFromMessage(savedMap);
    }
  }

  private updateTopologyFromMessage(msg: TopologyMap, notify: boolean = true): void {
    this.points.clear();
    if (msg.points && Array.isArray(msg.points)) {
      for (const point of msg.points) {
        this.points.set(point.name, point);
      }
    }
    
    this.routes = msg.routes || [];
    this.mapProperty = msg.map_property;
    
    if (notify) {
      this.notifyTopologyListeners();
    }
  }

  public getTopologyPoints(): TopoPoint[] {
    return Array.from(this.points.values());
  }

  public getTopologyRoutes(): Route[] {
    return [...this.routes];
  }

  public getTopologyPoint(name: string): TopoPoint | undefined {
    return this.points.get(name);
  }

  public setTopologyPoint(point: TopoPoint, oldName?: string): void {
    if (oldName && oldName !== point.name) {
      this.points.delete(oldName);
      this.routes = this.routes.map(route => {
        if (route.from_point === oldName) {
          return { ...route, from_point: point.name };
        }
        if (route.to_point === oldName) {
          return { ...route, to_point: point.name };
        }
        return route;
      });
    }
    this.points.set(point.name, point);
    this.notifyTopologyListeners();
  }

  public deleteTopologyPoint(name: string): void {
    this.points.delete(name);
    this.routes = this.routes.filter(
      r => r.from_point !== name && r.to_point !== name
    );
    this.notifyTopologyListeners();
  }

  public setTopologyRoute(route: Route): void {
    const index = this.routes.findIndex(
      r => r.from_point === route.from_point && r.to_point === route.to_point
    );
    if (index !== -1) {
      this.routes[index] = route;
    } else {
      this.routes.push(route);
    }
    this.notifyTopologyListeners();
  }

  public deleteTopologyRoute(route: Route): void {
    const index = this.routes.findIndex(
      r => r.from_point === route.from_point && r.to_point === route.to_point
    );
    if (index !== -1) {
      this.routes.splice(index, 1);
      this.notifyTopologyListeners();
    }
  }

  public updateTopologyMap(map: TopologyMap, notify: boolean = true): void {
    this.updateTopologyFromMessage(map, notify);
  }

  public getTopologyMap(): TopologyMap {
    const map: TopologyMap = {
      map_name: '',
      points: this.getTopologyPoints(),
      routes: this.getTopologyRoutes(),
    };
    
    if (this.mapProperty) {
      map.map_property = { ...this.mapProperty };
    }
    
    return map;
  }
  
  public getMapProperty(): { support_controllers?: string[]; support_goal_checkers?: string[] } | undefined {
    return this.mapProperty;
  }
  
  public updateMapProperty(property: { support_controllers?: string[]; support_goal_checkers?: string[] }): void {
    this.mapProperty = property;
    this.notifyTopologyListeners();
  }

  public addTopologyListener(listener: TopologyMapUpdateListener): void {
    this.topologyListeners.add(listener);
  }

  public removeTopologyListener(listener: TopologyMapUpdateListener): void {
    this.topologyListeners.delete(listener);
  }

  private notifyTopologyListeners(): void {
    const map = this.getTopologyMap();
    for (const listener of this.topologyListeners) {
      listener(map);
    }
  }

  public saveTopology(): void {
    const map = this.getTopologyMap();
    saveTopologyMap(map);
  }

  public publishTopology(connection?: RosbridgeConnection): void {
    const conn = connection || this.connection;
    if (!conn || !conn.isConnected()) {
      return;
    }

    const map = this.getTopologyMap();
    try {
      conn.publish('/map/topology/update', 'topology_msgs/msg/TopologyMap', map);
    } catch (error) {
      console.error('Failed to publish topology map:', error);
      throw error;
    }
  }

  public saveAndPublishTopology(connection?: RosbridgeConnection): void {
    this.saveTopology();
    this.publishTopology(connection);
  }

  public hasReceivedTopologyTopic(): boolean {
    return this.hasReceivedTopologyTopicMessage;
  }

  public updateOccupancyGrid(map: OccupancyGrid, notify: boolean = true): void {
    console.log('[MapManager] updateOccupancyGrid called', { 
      notify, 
      hasInfo: !!map.info, 
      hasData: !!map.data,
      width: map.info?.width,
      height: map.info?.height,
      dataLength: map.data?.length,
      listenersCount: this.occupancyGridListeners.size 
    });
    const clonedMap = JSON.parse(JSON.stringify(map));
    clonedMap.data = Array.isArray(map.data) ? [...map.data] : Array.from(map.data);
    this.currentOccupancyGrid = clonedMap;
    
    if (notify) {
      console.log('[MapManager] Notifying occupancy grid listeners', { count: this.occupancyGridListeners.size });
      this.notifyOccupancyGridListeners();
    }
  }

  public getOccupancyGrid(): OccupancyGrid | null {
    return this.currentOccupancyGrid;
  }

  public addOccupancyGridListener(listener: OccupancyGridUpdateListener): void {
    console.log('[MapManager] addOccupancyGridListener', { 
      listenersCountBefore: this.occupancyGridListeners.size 
    });
    this.occupancyGridListeners.add(listener);
    console.log('[MapManager] addOccupancyGridListener done', { 
      listenersCountAfter: this.occupancyGridListeners.size 
    });
  }

  public removeOccupancyGridListener(listener: OccupancyGridUpdateListener): void {
    this.occupancyGridListeners.delete(listener);
  }

  private notifyOccupancyGridListeners(): void {
    console.log('[MapManager] notifyOccupancyGridListeners', { 
      listenersCount: this.occupancyGridListeners.size,
      hasMap: !!this.currentOccupancyGrid 
    });
    for (const listener of this.occupancyGridListeners) {
      listener(this.currentOccupancyGrid);
    }
  }

  public publishOccupancyGrid(connection?: RosbridgeConnection): void {
    const conn = connection || this.connection;
    if (!conn || !conn.isConnected() || !this.currentOccupancyGrid) {
      return;
    }

    const map = this.getOccupancyGrid();
    if (!map) return;

    try {
      const now = Date.now();
      const mapToPublish = JSON.parse(JSON.stringify(map));
      mapToPublish.header.stamp = {
        sec: Math.floor(now / 1000),
        nsec: (now % 1000) * 1000000,
      };
      mapToPublish.data = Array.isArray(map.data) ? [...map.data] : Array.from(map.data);
      conn.publish('/map/update', 'nav_msgs/OccupancyGrid', mapToPublish);
    } catch (error) {
      console.error('Failed to publish occupancy grid:', error);
      throw error;
    }
  }
}

