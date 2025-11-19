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

type MapUpdateListener = (map: TopologyMap) => void;

export class TopologyMapManager {
  private static instance: TopologyMapManager | null = null;
  
  private points: Map<string, TopoPoint> = new Map();
  private routes: Route[] = [];
  private listeners: Set<MapUpdateListener> = new Set();
  private connection: RosbridgeConnection | null = null;
  private hasReceivedTopicMessage: boolean = false;

  private constructor() {
    this.loadFromLocalStorage();
  }

  public static getInstance(): TopologyMapManager {
    if (!TopologyMapManager.instance) {
      TopologyMapManager.instance = new TopologyMapManager();
    }
    return TopologyMapManager.instance;
  }

  public initialize(connection: RosbridgeConnection): void {
    if (this.connection === connection) {
      return;
    }
    
    this.connection = connection;
    
    if (connection.isConnected()) {
      this.subscribeToTopic();
    }
  }

  private subscribeToTopic(): void {
    if (!this.connection || !this.connection.isConnected()) {
      return;
    }

    const callback = (message: unknown) => {
      const msg = message as TopologyMap;
      if (msg.points && Array.isArray(msg.points)) {
        this.hasReceivedTopicMessage = true;
        this.updateFromMessage(msg);
      }
    };

    this.connection.subscribe('/map/topology', 'topology_msgs/msg/TopologyMap', callback);
  }

  private loadFromLocalStorage(): void {
    const savedMap = loadTopologyMap();
    if (savedMap && savedMap.points && Array.isArray(savedMap.points) && savedMap.points.length > 0) {
      this.updateFromMessage(savedMap);
    }
  }

  private updateFromMessage(msg: TopologyMap, notify: boolean = true): void {
    this.points.clear();
    if (msg.points && Array.isArray(msg.points)) {
      for (const point of msg.points) {
        this.points.set(point.name, point);
      }
    }
    
    this.routes = msg.routes || [];
    
    if (notify) {
      this.notifyListeners();
    }
  }

  public getPoints(): TopoPoint[] {
    return Array.from(this.points.values());
  }

  public getRoutes(): Route[] {
    return [...this.routes];
  }

  public getPoint(name: string): TopoPoint | undefined {
    return this.points.get(name);
  }

  public setPoint(point: TopoPoint): void {
    this.points.set(point.name, point);
    this.notifyListeners();
  }

  public deletePoint(name: string): void {
    this.points.delete(name);
    this.routes = this.routes.filter(
      r => r.from_point !== name && r.to_point !== name
    );
    this.notifyListeners();
  }

  public setRoute(route: Route): void {
    const index = this.routes.findIndex(
      r => r.from_point === route.from_point && r.to_point === route.to_point
    );
    if (index !== -1) {
      this.routes[index] = route;
    } else {
      this.routes.push(route);
    }
    this.notifyListeners();
  }

  public deleteRoute(route: Route): void {
    const index = this.routes.findIndex(
      r => r.from_point === route.from_point && r.to_point === route.to_point
    );
    if (index !== -1) {
      this.routes.splice(index, 1);
      this.notifyListeners();
    }
  }

  public updateMap(map: TopologyMap, notify: boolean = true): void {
    this.updateFromMessage(map, notify);
  }

  public getMap(): TopologyMap {
    return {
      map_name: '',
      points: this.getPoints(),
      routes: this.getRoutes(),
    };
  }

  public addListener(listener: MapUpdateListener): void {
    this.listeners.add(listener);
  }

  public removeListener(listener: MapUpdateListener): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const map = this.getMap();
    for (const listener of this.listeners) {
      listener(map);
    }
  }

  public save(): void {
    const map = this.getMap();
    saveTopologyMap(map);
  }

  public publish(connection?: RosbridgeConnection): void {
    const conn = connection || this.connection;
    if (!conn || !conn.isConnected()) {
      return;
    }

    const map = this.getMap();
    try {
      conn.publish('/map/topology/update', 'topology_msgs/msg/TopologyMap', map);
    } catch (error) {
      console.error('Failed to publish topology map:', error);
      throw error;
    }
  }

  public saveAndPublish(connection?: RosbridgeConnection): void {
    this.save();
    this.publish(connection);
  }

  public hasReceivedTopic(): boolean {
    return this.hasReceivedTopicMessage;
  }
}

