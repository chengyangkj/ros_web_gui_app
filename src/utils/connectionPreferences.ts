const STORAGE_KEY = 'ros_web_gui_connection_preferences';

export interface ConnectionPreferences {
  ip: string;
  port: string;
}

export function saveConnectionPreferences(preferences: ConnectionPreferences): void {
  try {
    const serialized = JSON.stringify(preferences);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.error('Failed to save connection preferences:', error);
  }
}

export function loadConnectionPreferences(): ConnectionPreferences | null {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized) {
      return JSON.parse(serialized) as ConnectionPreferences;
    }
  } catch (error) {
    console.error('Failed to load connection preferences:', error);
  }
  return null;
}

