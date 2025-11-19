interface TopologyMap {
  map_name: string;
  map_property?: {
    support_controllers?: string[];
    support_goal_checkers?: string[];
  };
  points: Array<{
    name: string;
    x: number;
    y: number;
    theta: number;
    type: number;
  }>;
  routes?: Array<{
    from_point: string;
    to_point: string;
    route_info: {
      controller: string;
      goal_checker: string;
      speed_limit: number;
    };
  }>;
}

const STORAGE_KEY = 'ros_web_gui_topology_map';

export function saveTopologyMap(map: TopologyMap): void {
  try {
    const serialized = JSON.stringify(map);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.error('Failed to save topology map:', error);
  }
}

export function loadTopologyMap(): TopologyMap | null {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized) {
      return JSON.parse(serialized) as TopologyMap;
    }
  } catch (error) {
    console.error('Failed to load topology map:', error);
  }
  return null;
}

