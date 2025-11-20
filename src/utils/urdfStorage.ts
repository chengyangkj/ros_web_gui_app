const URDF_STORAGE_KEY = 'ros_web_gui_urdf_path';
const URDF_FILE_STORAGE_KEY = 'ros_web_gui_urdf_file';
const URDF_PACKAGES_STORAGE_KEY = 'ros_web_gui_urdf_packages';

export interface UrdfConfig {
  packages: Record<string, string>;
  fileName: string;
}

export function saveUrdfConfig(config: UrdfConfig): void {
  try {
    // 不再保存 path（blob URL），只保存文件名和 packages
    localStorage.setItem(URDF_PACKAGES_STORAGE_KEY, JSON.stringify(config.packages));
    localStorage.setItem(URDF_FILE_STORAGE_KEY, config.fileName);
    // 清除旧的 path（如果存在）
    localStorage.removeItem(URDF_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to save URDF config:', error);
  }
}

export function loadUrdfConfig(): UrdfConfig | null {
  try {
    const packagesStr = localStorage.getItem(URDF_PACKAGES_STORAGE_KEY);
    const fileName = localStorage.getItem(URDF_FILE_STORAGE_KEY);
    
    if (packagesStr && fileName) {
      return {
        packages: JSON.parse(packagesStr),
        fileName,
      };
    }
  } catch (error) {
    console.error('Failed to load URDF config:', error);
  }
  return null;
}

export function clearUrdfConfig(): void {
  try {
    localStorage.removeItem(URDF_STORAGE_KEY);
    localStorage.removeItem(URDF_PACKAGES_STORAGE_KEY);
    localStorage.removeItem(URDF_FILE_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear URDF config:', error);
  }
}

