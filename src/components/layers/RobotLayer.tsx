import * as THREE from 'three';
import { LoadingManager } from 'three';
import URDFLoader from 'urdf-loader';
import { BaseLayer } from './BaseLayer';
import type { LayerConfig } from '../../types/LayerConfig';
import { TF2JS } from '../../utils/tf2js';
import { loadUrdfConfig } from '../../utils/urdfStorage';
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

  constructor(scene: THREE.Scene, config: LayerConfig, connection: any = null) {
    super(scene, config, connection);
    this.tf2js = TF2JS.getInstance();
    this.baseFrame = (config as any).baseFrame || 'base_link';
    this.mapFrame = (config as any).mapFrame || 'map';
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

  private async createCustomLoadingManager(): Promise<LoadingManager> {
    const manager = new LoadingManager();
    const savedFileNames = await getAllUrdfFileNames();
    const fileMap = new Map<string, string>();
    
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
    
    // 设置 URL 修改器，尝试从 IndexedDB 加载文件
    manager.setURLModifier((url: string) => {
      // 如果是 blob URL，直接返回
      if (url.startsWith('blob:')) {
        return url;
      }
      
      // 尝试匹配文件名
      const urlPath = url.split('/').pop() || url;
      if (fileMap.has(urlPath)) {
        return fileMap.get(urlPath)!;
      }
      
      // 尝试匹配完整路径
      const normalizedUrl = url.replace(/\\/g, '/');
      for (const [fileName, blobUrl] of fileMap.entries()) {
        if (normalizedUrl.includes(fileName) || fileName.includes(urlPath)) {
          return blobUrl;
        }
      }
      
      // 如果找不到，返回原始 URL
      return url;
    });
    
    return manager;
  }

  private async loadUrdfModel(): Promise<void> {
    if (this.isLoadingUrdf) {
      return Promise.resolve();
    }

    this.isLoadingUrdf = true;

    try {
      const savedConfig = loadUrdfConfig();
      let urdfPath = '/urdf/x2w/x2w.urdf';
      let packages: Record<string, string> = {
        'nav_bringup': '/urdf/x2w/',
      };

      if (savedConfig) {
        // 从 IndexedDB 加载文件内容并创建新的 blob URL
        const fileContent = await loadUrdfFile(savedConfig.fileName);
        if (fileContent && typeof fileContent === 'string') {
          urdfPath = createBlobUrl(fileContent, 'application/xml');
        } else {
          console.warn('[RobotLayer] Failed to load URDF file from IndexedDB:', savedConfig.fileName);
          // 如果加载失败，使用默认路径
        }
        packages = savedConfig.packages;
      }

      const manager = await this.createCustomLoadingManager();
      const loader = new URDFLoader(manager);
      loader.packages = packages;

      await new Promise<void>((resolve, reject) => {
        loader.load(
          urdfPath,
          (robot: any) => {
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
      throw error;
    }
  }

  public reloadUrdf(): void {
    if (this.urdfRobot && this.robotGroup) {
      this.robotGroup.remove(this.urdfRobot);
      this.disposeObject3D(this.urdfRobot);
      this.urdfRobot = null;
    }
    this.loadUrdfModel().catch((error) => {
      console.error('[RobotLayer] Failed to reload URDF model:', error);
    });
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

  update(_message: unknown): void {
    // TF2JS 单例会自动处理消息更新，这里不需要处理
  }

  setConfig(config: LayerConfig): void {
    super.setConfig(config);
    const cfg = config as any;
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

