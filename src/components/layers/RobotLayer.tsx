import * as THREE from 'three';
import { LoadingManager, LoaderUtils } from 'three';
import URDFLoader from 'urdf-loader';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import type { RosbridgeConnection } from '../../utils/RosbridgeConnection';
import { TF2JS } from '../../utils/tf2js';
import { getCurrentUrdfConfig } from '../../utils/urdfStorage';
import { loadUrdfFile, createBlobUrl, getAllUrdfFileNames, getFileUrl } from '../../utils/urdfFileStorage';
import robotSvgUrl from '../../assets/robot.svg?url';

export class RobotLayer extends BaseLayer {
  private robotGroup: THREE.Group | null = null;
  private urdfRobot: THREE.Group | null = null;
  private tf2js: TF2JS;
  private baseFrame: string;
  private mapFrame: string;
  private transformChangeUnsubscribe: (() => void) | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private iconMesh: THREE.Mesh | null = null;
  private isLoadingUrdf: boolean = false;

  constructor(scene: THREE.Scene, config: LayerConfig, connection: RosbridgeConnection | null = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.baseFrame = (config.baseFrame as string | undefined) || 'base_link';
    this.mapFrame = (config.mapFrame as string | undefined) || 'map';
    this.createRobot();
    this.updateRobotTransform();
    this.transformChangeUnsubscribe = this.tf2js.onTransformChange(() => {
      this.updateRobotTransform();
    });
    this.updateInterval = setInterval(() => {
      this.updateRobotTransform();
    }, 100);
  }

  getMessageType(): string | null {
    return null;
  }

  private createSVGTexture(): Promise<THREE.Texture> {
    return new Promise<THREE.Texture>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 1024;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.flipY = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 16;
        resolve(texture);
      };
      img.onerror = () => {
        const loader = new THREE.TextureLoader();
        const texture = loader.load(robotSvgUrl);
        texture.flipY = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 16;
        resolve(texture);
      };
      img.src = robotSvgUrl;
    });
  }

  private createRobot(): void {
    const robotGroup = new THREE.Group();
    this.robotGroup = robotGroup;
    this.object3D = robotGroup;
    this.scene.add(robotGroup);

    this.loadUrdfModel().catch((error) => {
      console.error('[RobotLayer] Failed to load URDF model, falling back to SVG icon:', error);
      this.createSVGIcon();
    });
  }

  private async createCustomLoadingManager(packages?: Record<string, string>): Promise<LoadingManager> {
    const manager = new LoadingManager();
    const savedFileNames = await getAllUrdfFileNames();
    const fileMap = new Map<string, string>();
    const missingPackages = new Set<string>();
    const missingFiles = new Set<string>();
    
    // 预加载所有文件的 blob URL
    for (const fileName of savedFileNames) {
      const blobUrl = await getFileUrl(fileName);
      if (blobUrl) {
        fileMap.set(fileName, blobUrl);
        // 也存储相对路径的映射
        const baseName = fileName.split('/').pop() || fileName;
        fileMap.set(baseName, blobUrl);
      }
    }
    
    // 设置错误处理
    manager.onError = () => {
      if (missingPackages.size > 0) {
        const error = new Error(`以下包未在配置中找到: ${Array.from(missingPackages).join(', ')}`);
        console.error('[RobotLayer] LoadingManager error:', error.message);
        throw error;
      }
      if (missingFiles.size > 0) {
        const error = new Error(`以下文件未找到: ${Array.from(missingFiles).join(', ')}`);
        console.error('[RobotLayer] LoadingManager error:', error.message);
        throw error;
      }
    };
    
    // 设置 URL 修改器，尝试从 IndexedDB 加载文件
    manager.setURLModifier((url: string) => {
      console.log('[RobotLayer] URL modifier - original URL:', url);
      
      // 处理包含 file://$(find ...) 的 URL（即使是以 blob: 开头）
      let processedUrl = url;
      
      // 如果 URL 包含 $(find ...)，需要处理（可能包含 file:// 前缀，也可能没有）
      if (url.includes('$(find')) {
        // 提取 $(find package_name)/... 部分（可能前面有 file://）
        const fileMatch = url.match(/(?:file:\/\/)?\$\(find\s+([^)]+)\)([^"']*)/);
        if (fileMatch) {
          const packageName = fileMatch[1];
          const relativePath = fileMatch[2]; // 例如：/urdf/x2w/meshes/base_w.stl
          
          // 如果包名不在配置中，记录错误
          if (!packages || !packages[packageName]) {
            missingPackages.add(packageName);
            console.error(`[RobotLayer] URL modifier - 包 "${packageName}" 未在 URDF 配置中找到`);
            // 返回一个无效的URL，让LoadingManager触发onError
            return `error://package-not-found/${packageName}`;
          }
          const packagePath = packages[packageName];
          
          // 构建完整路径：packagePath + relativePath
          // 例如：/urdf/x2w/ + /urdf/x2w/meshes/base_w.stl -> /urdf/x2w/urdf/x2w/meshes/base_w.stl
          // 但实际上 relativePath 可能已经包含了包路径，所以我们需要提取实际的文件路径
          // 例如：/urdf/x2w/meshes/base_w.stl -> meshes/base_w.stl 或 x2w/meshes/base_w.stl
          const pathParts = relativePath.split('/').filter(p => p.length > 0);
          console.log('[RobotLayer] URL modifier - package:', packageName, 'path:', packagePath, 'relativePath:', relativePath, 'pathParts:', pathParts);
          
          // 从相对路径中提取实际的文件路径
          // 例如：/urdf/x2w/meshes/base_w.stl -> x2w/meshes/base_w.stl 或 meshes/base_w.stl
          let searchPath = relativePath.replace(/^\/+/, '');
          // 如果路径以 urdf/ 开头，去掉它
          if (searchPath.startsWith('urdf/')) {
            searchPath = searchPath.substring(5);
          }
          
          console.log('[RobotLayer] URL modifier - searchPath:', searchPath);
          console.log('[RobotLayer] URL modifier - available files:', Array.from(fileMap.keys()));
          
          // 从后往前匹配路径部分
          const searchParts = searchPath.split('/').filter(p => p.length > 0);
          console.log('[RobotLayer] URL modifier - searchParts:', searchParts);
          
          // 先尝试最长的匹配（例如：x2w/meshes/base_w.stl）
          for (let len = searchParts.length; len >= 1; len--) {
            const partialPath = searchParts.slice(-len).join('/');
            console.log('[RobotLayer] URL modifier - trying to match:', partialPath, `(${len} parts)`);
            
            for (const [fileName, blobUrl] of fileMap.entries()) {
              // 优先检查文件名是否以这个部分路径结尾（精确匹配）
              if (fileName.endsWith(partialPath)) {
                console.log('[RobotLayer] URL modifier - found end match:', fileName, 'for', partialPath);
                return blobUrl;
              }
            }
          }
          
          // 如果精确匹配失败，尝试包含匹配
          for (let len = searchParts.length; len >= 1; len--) {
            const partialPath = searchParts.slice(-len).join('/');
            for (const [fileName, blobUrl] of fileMap.entries()) {
              if (fileName.includes(partialPath)) {
                console.log('[RobotLayer] URL modifier - found contains match:', fileName, 'for', partialPath);
                return blobUrl;
              }
            }
          }
          
          console.warn('[RobotLayer] URL modifier - no match found for searchPath:', searchPath);
        }
      }
      
      // 如果是纯 blob URL（不包含 file://），直接返回
      if (url.startsWith('blob:') && !url.includes('file://')) {
        return url;
      }
      
      // 移除 file:// 前缀（如果还有）
      processedUrl = processedUrl.replace(/^file:\/\//, '');
      
      // 尝试直接匹配处理后的 URL
      if (fileMap.has(processedUrl)) {
        console.log('[RobotLayer] URL modifier - found direct match:', processedUrl);
        return fileMap.get(processedUrl)!;
      }
      
      // 尝试匹配文件名
      const urlPath = processedUrl.split('/').pop() || processedUrl;
      if (fileMap.has(urlPath)) {
        console.log('[RobotLayer] URL modifier - found filename match:', urlPath);
        return fileMap.get(urlPath)!;
      }
      
      // 尝试匹配路径的末尾部分（从后往前匹配）
      const normalizedUrl = processedUrl.replace(/\\/g, '/').replace(/^\/+/, '');
      const urlParts = normalizedUrl.split('/').filter(p => p.length > 0);
      
      // 从后往前尝试匹配，逐步增加路径部分
      // 例如：file://$(find nav_bringup)/urdf/x2w/meshes/base_collider.stl
      // 应该匹配到：x2w/meshes/base_collider.stl 或 meshes/base_collider.stl
      // 先尝试最长的匹配，然后逐步缩短
      for (let len = urlParts.length; len >= 1; len--) {
        const partialPath = urlParts.slice(-len).join('/');
        console.log('[RobotLayer] URL modifier - trying to match:', partialPath, `(${len} parts)`);
        
        for (const [fileName, blobUrl] of fileMap.entries()) {
          // 优先检查文件名是否以这个部分路径结尾（精确匹配）
          if (fileName.endsWith(partialPath)) {
            console.log('[RobotLayer] URL modifier - found end match:', fileName, 'for', partialPath);
            return blobUrl;
          }
        }
      }
      
      // 如果精确匹配失败，尝试包含匹配
      for (let len = urlParts.length; len >= 1; len--) {
        const partialPath = urlParts.slice(-len).join('/');
        for (const [fileName, blobUrl] of fileMap.entries()) {
          // 检查文件名是否包含这个部分路径
          if (fileName.includes(partialPath)) {
            console.log('[RobotLayer] URL modifier - found contains match:', fileName, 'for', partialPath);
            return blobUrl;
          }
        }
      }
      
      // 如果还是找不到，尝试只匹配文件名（最后一部分）
      const fileNameOnly = urlParts[urlParts.length - 1];
      if (fileNameOnly && fileMap.has(fileNameOnly)) {
        console.log('[RobotLayer] URL modifier - found filename match:', fileNameOnly);
        return fileMap.get(fileNameOnly)!;
      }
      
      // 如果找不到，记录错误
      missingFiles.add(url);
      console.error('[RobotLayer] URL modifier - 无法在已上传的文件中找到匹配的资源:', url, 'processed:', processedUrl);
      // 返回一个无效的URL，让LoadingManager触发onError
      return `error://file-not-found/${url}`;
    });
    
    return manager;
  }

  private async loadUrdfModel(): Promise<void> {
    if (this.isLoadingUrdf) {
      return Promise.resolve();
    }

    this.isLoadingUrdf = true;

    try {
      console.log('[RobotLayer] loadUrdfModel - starting');
      const savedConfig = getCurrentUrdfConfig();
      console.log('[RobotLayer] loadUrdfModel - savedConfig:', savedConfig);
      
      // 如果没有保存的配置，使用 SVG 图标
      if (!savedConfig) {
        console.log('[RobotLayer] loadUrdfModel - no saved config, falling back to SVG icon');
        this.isLoadingUrdf = false;
        this.createSVGIcon();
        return;
      }


      console.log('[RobotLayer] loadUrdfModel - using saved config:', savedConfig);
      console.log('[RobotLayer] loadUrdfModel - config fileName:', savedConfig.fileName);
      
      // 检查包配置
      if (!savedConfig.packages || Object.keys(savedConfig.packages).length === 0) {
        const error = new Error('URDF 配置中未找到任何包引用，无法加载模型');
        console.error('[RobotLayer]', error.message);
        this.isLoadingUrdf = false;
        throw error;
      }
      
      // 从 IndexedDB 加载文件内容
      const fileContent = await loadUrdfFile(savedConfig.fileName);
      console.log('[RobotLayer] loadUrdfModel - fileContent loaded:', fileContent ? (typeof fileContent === 'string' ? `string (${fileContent.length} chars)` : `ArrayBuffer (${fileContent.byteLength} bytes)`) : 'null');
      
      // 如果加载失败，检查是否是文件不存在的问题
      if (!fileContent) {
        // 列出所有可用的文件以便调试
        const allFiles = await getAllUrdfFileNames();
        console.error('[RobotLayer] Failed to load URDF file from IndexedDB:', savedConfig.fileName);
        console.error('[RobotLayer] Available files in IndexedDB:', allFiles);
        
        
        const error = new Error(`Failed to load URDF file from IndexedDB: ${savedConfig.fileName}. File may have been deleted or never saved.`);
        console.error('[RobotLayer]', error.message);
        this.isLoadingUrdf = false;
        throw error;
      }
      
      // 将 ArrayBuffer 转换为字符串（如果必要）
      let urdfContent: string;
      if (typeof fileContent === 'string') {
        urdfContent = fileContent;
      } else {
        // ArrayBuffer 转字符串
        const decoder = new TextDecoder('utf-8');
        urdfContent = decoder.decode(fileContent);
        console.log('[RobotLayer] loadUrdfModel - converted ArrayBuffer to string, length:', urdfContent.length);
      }

      // URDF 文件直接使用
      console.log('[RobotLayer] loadUrdfModel - using URDF file directly');
      const urdfPath = createBlobUrl(urdfContent, 'application/xml');
      const workingPath = LoaderUtils.extractUrlBase(urdfPath);
      const packages = savedConfig.packages;

      const manager = await this.createCustomLoadingManager(packages);
      const loader = new URDFLoader(manager);
      loader.packages = packages;
      if (workingPath) {
        (loader as typeof loader & { workingPath?: string }).workingPath = workingPath;
      }

      console.log('[RobotLayer] loadUrdfModel - loading URDF from path:', urdfPath);
      await new Promise<void>((resolve, reject) => {
        loader.load(
          urdfPath,
          (robot: THREE.Group) => {
            this.isLoadingUrdf = false;
            if (!this.robotGroup) {
              reject(new Error('RobotGroup was disposed during loading'));
              return;
            }

            if (this.iconMesh) {
              this.robotGroup!.remove(this.iconMesh);
              if (this.iconMesh.geometry) {
                this.iconMesh.geometry.dispose();
              }
              if (this.iconMesh.material) {
                const material = this.iconMesh.material as THREE.MeshBasicMaterial;
                if (material.map) {
                  material.map.dispose();
                }
                material.dispose();
              }
              this.iconMesh = null;
            }

            if (this.urdfRobot) {
              this.robotGroup!.remove(this.urdfRobot);
              this.disposeObject3D(this.urdfRobot);
              this.urdfRobot = null;
            }

            const robotGroup = robot as THREE.Group;
            this.urdfRobot = robotGroup;
            
            robotGroup.position.set(0, 0, 0);
            robotGroup.quaternion.set(0, 0, 0, 1);
            
            robotGroup.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => {
                      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial) {
                        mat.needsUpdate = true;
                      }
                    });
                  } else if (child.material instanceof THREE.MeshStandardMaterial || child.material instanceof THREE.MeshPhongMaterial) {
                    child.material.needsUpdate = true;
                  }
                }
              }
            });
            
            this.robotGroup!.add(robotGroup);
            this.updateRobotTransform();
            resolve();
          },
          undefined,
          (error) => {
            this.isLoadingUrdf = false;
            reject(error);
          }
        );
      });
    } catch (error) {
      this.isLoadingUrdf = false;
      // 确保错误信息被正确传递
      if (error instanceof Error) {
        console.error('[RobotLayer] loadUrdfModel failed:', error.message);
        throw error;
      } else {
        const errorMsg = String(error);
        console.error('[RobotLayer] loadUrdfModel failed:', errorMsg);
        throw new Error(errorMsg);
      }
    }
  }

  public async reloadUrdf(): Promise<void> {
    if (this.urdfRobot && this.robotGroup) {
      this.robotGroup.remove(this.urdfRobot);
      this.disposeObject3D(this.urdfRobot);
      this.urdfRobot = null;
    }
    try {
      await this.loadUrdfModel();
    } catch (error) {
      console.error('[RobotLayer] Failed to reload URDF model:', error);
      this.createSVGIcon();
      throw error;
    }
  }

  private createSVGIcon(): void {
    if (!this.robotGroup) return;

    this.createSVGTexture().then((texture) => {
      if (!this.robotGroup) return;
      const geometry = new THREE.PlaneGeometry(0.2, 0.2);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        alphaTest: 0.1,
      });
      const iconMesh = new THREE.Mesh(geometry, material);
      iconMesh.position.set(0, 0, 0.001);
      iconMesh.rotation.set(0, 0, Math.PI / 4);
      this.iconMesh = iconMesh;
      this.robotGroup!.add(iconMesh);
    }).catch((error) => {
      console.error('[RobotLayer] Failed to load SVG texture:', error);
    });
  }

  private updateRobotTransform(): void {
    if (!this.robotGroup) {
      return;
    }

 
    const transform = this.tf2js.findTransform( this.mapFrame, this.baseFrame);
    if (transform) {
      // The transform gives us base_center's position and orientation in map frame
      this.robotGroup.position.set(
        transform.translation.x,
        transform.translation.y,
        transform.translation.z
      );
      this.robotGroup.quaternion.copy(transform.rotation);
    } else {
      console.warn('[RobotLayer] Transform not found:', {
        mapFrame: this.mapFrame,
        baseFrame: this.baseFrame,
        availableFrames: this.tf2js.getFrames()
      });
    }
  }

  update(): void {
    // TF2JS 单例会自动处理消息更新，这里不需要处理
  }

  setConfig(config: LayerConfig): void {
    super.setConfig(config);
    const cfg = config as LayerConfig & { baseFrame?: string; mapFrame?: string };
    if (cfg.baseFrame) {
      this.baseFrame = cfg.baseFrame;
    }
    if (cfg.mapFrame) {
      this.mapFrame = cfg.mapFrame;
    }
    this.updateRobotTransform();
  }

  dispose(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.transformChangeUnsubscribe) {
      this.transformChangeUnsubscribe();
      this.transformChangeUnsubscribe = null;
    }
    if (this.iconMesh) {
      if (this.iconMesh.geometry) {
        this.iconMesh.geometry.dispose();
      }
      if (this.iconMesh.material) {
        const material = this.iconMesh.material as THREE.MeshBasicMaterial;
        if (material.map) {
          material.map.dispose();
        }
        material.dispose();
      }
      this.iconMesh = null;
    }
    if (this.urdfRobot) {
      this.disposeObject3D(this.urdfRobot);
      this.urdfRobot = null;
    }
    if (this.robotGroup) {
      this.scene.remove(this.robotGroup);
      this.disposeObject3D(this.robotGroup);
      this.robotGroup = null;
    }
    super.dispose();
  }
}

