const URDF_CONFIGS_KEY = 'ros_web_gui_urdf_configs';
const URDF_CURRENT_KEY = 'ros_web_gui_urdf_current';

export interface UrdfConfig {
  id: string;
  packages: Record<string, string>;
  fileName: string;
  uploadTime: number;
}

export interface UrdfConfigs {
  configs: UrdfConfig[];
  currentId: string | null;
}

function migrateOldConfig(): UrdfConfigs | null {
  try {
    const packagesStr = localStorage.getItem('ros_web_gui_urdf_packages');
    const fileName = localStorage.getItem('ros_web_gui_urdf_file');
    
    if (packagesStr && fileName) {
      const config: UrdfConfig = {
        id: `migrated_${Date.now()}`,
        packages: JSON.parse(packagesStr),
        fileName,
        uploadTime: Date.now(),
      };
      
      localStorage.removeItem('ros_web_gui_urdf_path');
      localStorage.removeItem('ros_web_gui_urdf_packages');
      localStorage.removeItem('ros_web_gui_urdf_file');
      
      return {
        configs: [config],
        currentId: config.id,
      };
    }
  } catch (error) {
    console.error('Failed to migrate old config:', error);
  }
  return null;
}

export function getAllUrdfConfigs(): UrdfConfigs {
  try {
    const configsStr = localStorage.getItem(URDF_CONFIGS_KEY);
    
    if (configsStr) {
      return JSON.parse(configsStr) as UrdfConfigs;
    }
    
    const migrated = migrateOldConfig();
    if (migrated) {
      saveAllUrdfConfigs(migrated);
      return migrated;
    }
  } catch (error) {
    console.error('Failed to load URDF configs:', error);
  }
  
  return { configs: [], currentId: null };
}

export function saveAllUrdfConfigs(configs: UrdfConfigs): void {
  try {
    localStorage.setItem(URDF_CONFIGS_KEY, JSON.stringify(configs));
    if (configs.currentId) {
      localStorage.setItem(URDF_CURRENT_KEY, configs.currentId);
    } else {
      localStorage.removeItem(URDF_CURRENT_KEY);
    }
  } catch (error) {
    console.error('Failed to save URDF configs:', error);
  }
}

export function addUrdfConfig(config: Omit<UrdfConfig, 'id' | 'uploadTime'>): UrdfConfig {
  const newConfig: UrdfConfig = {
    ...config,
    id: `urdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    uploadTime: Date.now(),
  };
  
  const allConfigs = getAllUrdfConfigs();
  allConfigs.configs.push(newConfig);
  
  if (!allConfigs.currentId) {
    allConfigs.currentId = newConfig.id;
  }
  
  saveAllUrdfConfigs(allConfigs);
  return newConfig;
}

export function deleteUrdfConfig(configId: string): void {
  const allConfigs = getAllUrdfConfigs();
  allConfigs.configs = allConfigs.configs.filter(c => c.id !== configId);
  
  if (allConfigs.currentId === configId) {
    allConfigs.currentId = allConfigs.configs.length > 0 ? allConfigs.configs[0].id : null;
  }
  
  saveAllUrdfConfigs(allConfigs);
}

export function setCurrentUrdfConfig(configId: string): void {
  const allConfigs = getAllUrdfConfigs();
  if (allConfigs.configs.some(c => c.id === configId)) {
    allConfigs.currentId = configId;
    saveAllUrdfConfigs(allConfigs);
  }
}

export function getCurrentUrdfConfig(): UrdfConfig | null {
  const allConfigs = getAllUrdfConfigs();
  
  if (!allConfigs.currentId) {
    return null;
  }
  
  return allConfigs.configs.find(c => c.id === allConfigs.currentId) || null;
}

export function loadUrdfConfig(): UrdfConfig | null {
  return getCurrentUrdfConfig();
}

export function saveUrdfConfig(config: Omit<UrdfConfig, 'id' | 'uploadTime'>): void {
  addUrdfConfig(config);
}

export function clearUrdfConfig(): void {
  localStorage.removeItem(URDF_CONFIGS_KEY);
  localStorage.removeItem(URDF_CURRENT_KEY);
}
