import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import JSZip from 'jszip';
import type { LayerConfigMap } from '../types/LayerConfig';
import type { ColorModes } from '../utils/colorUtils';
import { getAllUrdfConfigs, addUrdfConfig, deleteUrdfConfig, setCurrentUrdfConfig, type UrdfConfig } from '../utils/urdfStorage';
import { saveUrdfFile, saveUrdfFiles, deleteUrdfFile } from '../utils/urdfFileStorage';
import { TF2JS } from '../utils/tf2js';
import './LayerSettingsPanel.css';

interface LayerSettingsPanelProps {
  layerConfigs: LayerConfigMap;
  onConfigChange: (layerId: string, config: Partial<import('../types/LayerConfig').LayerConfig>) => void;
  onResetToDefaults: () => void;
  onClose: () => void;
  onUrdfConfigChange?: () => void;
  onDeleteLayer?: (layerId: string) => void;
}

export function LayerSettingsPanel({ layerConfigs, onConfigChange, onResetToDefaults, onClose, onUrdfConfigChange, onDeleteLayer }: LayerSettingsPanelProps) {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [editingFields, setEditingFields] = useState<Map<string, string>>(new Map());
  const [editingValues, setEditingValues] = useState<Map<string, string>>(new Map());
  const [urdfConfigs, setUrdfConfigs] = useState<UrdfConfig[]>([]);
  const [currentUrdfId, setCurrentUrdfId] = useState<string | null>(null);
  const [showUrdfSelector, setShowUrdfSelector] = useState(false);
  const [urdfFileOptions, setUrdfFileOptions] = useState<{ files: string[], zip: JSZip | null, filesToSave: Map<string, string | ArrayBuffer>, fileTypes: ('urdf' | 'xacro')[] }>({ files: [], zip: null, filesToSave: new Map(), fileTypes: [] });
  const urdfFileInputRef = useRef<HTMLInputElement>(null);
  const [tfFrames, setTfFrames] = useState<string[]>([]);
  const [showAddImageDialog, setShowAddImageDialog] = useState(false);
  const [newImageTopic, setNewImageTopic] = useState('');
  const [newImageType, setNewImageType] = useState<'sensor_msgs/Image' | 'sensor_msgs/CompressedImage'>('sensor_msgs/Image');

  const toggleLayer = (layerId: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const handleToggleEnabled = (layerId: string, enabled: boolean) => {
    onConfigChange(layerId, { enabled });
  };

  const handleFieldChange = (layerId: string, field: string, value: unknown) => {
    onConfigChange(layerId, { [field]: value });
    setEditingFields((prev) => {
      const next = new Map(prev);
      next.delete(`${layerId}_${field}`);
      return next;
    });
    setEditingValues((prev) => {
      const next = new Map(prev);
      next.delete(`${layerId}_${field}`);
      return next;
    });
  };

  const startEditing = (layerId: string, field: string, currentValue: string | null | undefined) => {
    setEditingFields((prev) => new Map(prev).set(`${layerId}_${field}`, field));
    setEditingValues((prev) => new Map(prev).set(`${layerId}_${field}`, String(currentValue || '')));
  };

  const updateEditingValue = (layerId: string, field: string, value: string) => {
    setEditingValues((prev) => {
      const next = new Map(prev);
      next.set(`${layerId}_${field}`, value);
      return next;
    });
  };

  const getEditingValue = (layerId: string, field: string, defaultValue: string | null | undefined): string => {
    const key = `${layerId}_${field}`;
    if (editingValues.has(key)) {
      return editingValues.get(key) || '';
    }
    return String(defaultValue || '');
  };

  const isEditing = (layerId: string, field: string): boolean => {
    return editingFields.get(`${layerId}_${field}`) === field;
  };

  useEffect(() => {
    loadUrdfConfigs();
    updateTfFrames();
    const interval = setInterval(updateTfFrames, 1000);
    return () => clearInterval(interval);
  }, []);

  const updateTfFrames = () => {
    const tf2js = TF2JS.getInstance();
    const frames = tf2js.getFrames();
    setTfFrames(frames);
  };

  const handleTfFrameToggle = (layerId: string, frameId: string, enabled: boolean) => {
    const config = layerConfigs[layerId];
    if (!config) return;
    
    let enabledFrames = new Set((config.enabledFrames as string[] | undefined) || []);
    
    // 如果当前 enabledFrames 为空（表示显示所有），且用户要取消某个坐标系
    // 需要先将所有当前显示的坐标系添加到 enabledFrames 中
    if (enabledFrames.size === 0 && !enabled) {
      enabledFrames = new Set(tfFrames);
      console.log('[LayerSettingsPanel] Initializing enabledFrames with all frames:', Array.from(enabledFrames));
    }
    
    if (enabled) {
      enabledFrames.add(frameId);
    } else {
      enabledFrames.delete(frameId);
    }
    
    // 如果所有坐标系都被取消勾选，将 enabledFrames 设置为空数组（表示显示所有）
    const newEnabledFrames = enabledFrames.size === tfFrames.length ? [] : Array.from(enabledFrames);
    console.log('[LayerSettingsPanel] handleTfFrameToggle:', { frameId, enabled, enabledFramesSize: enabledFrames.size, tfFramesLength: tfFrames.length, newEnabledFrames });
    onConfigChange(layerId, { enabledFrames: newEnabledFrames });
  };

  const loadUrdfConfigs = () => {
    const allConfigs = getAllUrdfConfigs();
    setUrdfConfigs(allConfigs.configs);
    setCurrentUrdfId(allConfigs.currentId);
  };

  const extractMeshPaths = (urdfText: string): string[] => {
    const meshPaths: string[] = [];
    const meshRegex = /<mesh\s+filename=["']([^"']+)["']/gi;
    let match;
    while ((match = meshRegex.exec(urdfText)) !== null) {
      meshPaths.push(match[1]);
    }
    return meshPaths;
  };

  const handleUrdfUpload = () => {
    urdfFileInputRef.current?.click();
  };

  const handleUrdfFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      let urdfFileName = '';
      let urdfContent = '';
      const filesToSave = new Map<string, string | ArrayBuffer>();

      if (file.name.endsWith('.zip') || file.name.endsWith('.ZIP')) {
        toast.info('正在解压 ZIP 文件...');
        const zip = await JSZip.loadAsync(file);
        const fileNames = Object.keys(zip.files);
        
        const urdfFiles = fileNames.filter(name => {
          const lower = name.toLowerCase();
          return lower.endsWith('.urdf') && !zip.files[name].dir;
        });
        
        if (urdfFiles.length === 0) {
          toast.error('ZIP 文件中未找到 URDF 文件');
          return;
        }
        
        for (const fileName of fileNames) {
          const zipFile = zip.files[fileName];
          if (!zipFile.dir) {
            const content = await zipFile.async('uint8array');
            const buffer = new ArrayBuffer(content.length);
            new Uint8Array(buffer).set(content);
            filesToSave.set(fileName, buffer);
          }
        }
        
        if (urdfFiles.length === 1) {
          urdfFileName = urdfFiles[0];
          urdfContent = await zip.files[urdfFileName].async('string');
          await saveUrdfFiles(filesToSave);
          toast.success(`已解压 ${filesToSave.size} 个文件`);
        } else {
          // 多个文件，显示选择对话框
          const fileTypes = urdfFiles.map(() => 'urdf' as const);
          setUrdfFileOptions({ files: urdfFiles, zip, filesToSave, fileTypes });
          setShowUrdfSelector(true);
          return;
        }
      } else if (file.name.endsWith('.urdf') || file.name.endsWith('.URDF')) {
        urdfFileName = file.name;
        urdfContent = await file.text();
        await saveUrdfFile(urdfFileName, urdfContent);
        
        const meshPaths = extractMeshPaths(urdfContent);
        if (meshPaths.length > 0) {
          toast.warning(`检测到 ${meshPaths.length} 个 mesh 文件引用。建议上传包含所有文件的 ZIP 压缩包。`);
        }
      } else {
        toast.error('请选择 URDF 文件或包含 URDF 的 ZIP 压缩包');
        return;
      }

      const packages: Record<string, string> = {};
      // 提取所有 $(find package_name) 引用（不仅仅是 file:// 开头的）
      const allPackageMatches = urdfContent.matchAll(/\$\(find\s+([^)]+)\)/g);
      for (const match of allPackageMatches) {
        const packageName = match[1];
        if (!packages[packageName]) {
          packages[packageName] = '/urdf/';
        }
      }
      
      if (Object.keys(packages).length === 0) {
        toast.error('URDF 文件中未找到任何包引用（$(find ...)），无法确定文件路径');
        return;
      }

      addUrdfConfig({
        packages,
        fileName: urdfFileName,
      });
      toast.success(`URDF 文件已保存: ${urdfFileName}`);
      
      loadUrdfConfigs();
      if (onUrdfConfigChange) {
        onUrdfConfigChange();
      }
    } catch (error) {
      console.error('上传 URDF 失败:', error);
      toast.error('上传 URDF 失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      if (urdfFileInputRef.current) {
        urdfFileInputRef.current.value = '';
      }
    }
  };

  const handleUrdfSelect = (configId: string) => {
    setCurrentUrdfConfig(configId);
    setCurrentUrdfId(configId);
    if (onUrdfConfigChange) {
      onUrdfConfigChange();
    }
    toast.success('已切换 URDF 配置');
  };

  const handleUrdfDelete = async (config: UrdfConfig) => {
    if (!confirm(`确定要删除 "${config.fileName}" 吗？`)) {
      return;
    }

    try {
      const remainingConfigs = getAllUrdfConfigs();
      const isFileUsed = remainingConfigs.configs.some(c => c.id !== config.id && c.fileName === config.fileName);
      
      if (!isFileUsed) {
        await deleteUrdfFile(config.fileName);
      }
      
      deleteUrdfConfig(config.id);
      loadUrdfConfigs();
      
      if (onUrdfConfigChange) {
        onUrdfConfigChange();
      }
      toast.success('已删除 URDF 配置');
    } catch (error) {
      console.error('[LayerSettingsPanel] Failed to delete URDF config:', error);
      toast.error('删除失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleUrdfFileSelectConfirm = async (selectedFileName: string) => {
    try {
      const { zip, filesToSave } = urdfFileOptions;
      if (!zip) return;

      const urdfContent = await zip.files[selectedFileName].async('string');
      
      // 保存所有文件
      await saveUrdfFiles(filesToSave);
      toast.success(`已解压 ${filesToSave.size} 个文件`);

      // 解析 packages
      const packages: Record<string, string> = {};
      // 提取所有 $(find package_name) 引用（不仅仅是 file:// 开头的）
      const allPackageMatches = urdfContent.matchAll(/\$\(find\s+([^)]+)\)/g);
      for (const match of allPackageMatches) {
        const packageName = match[1];
        if (!packages[packageName]) {
          packages[packageName] = '/urdf/';
        }
      }
      
      if (Object.keys(packages).length === 0) {
        toast.error('URDF 文件中未找到任何包引用（$(find ...)），无法确定文件路径');
        return;
      }

      addUrdfConfig({
        packages,
        fileName: selectedFileName,
      });
      toast.success(`URDF 文件已保存: ${selectedFileName}`);
      
      loadUrdfConfigs();
      if (onUrdfConfigChange) {
        onUrdfConfigChange();
      }

      setShowUrdfSelector(false);
      setUrdfFileOptions({ files: [], zip: null, filesToSave: new Map(), fileTypes: [] });
    } catch (error) {
      console.error('处理 URDF 文件失败:', error);
      toast.error('处理 URDF 文件失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleUrdfFileSelectCancel = () => {
    setShowUrdfSelector(false);
    setUrdfFileOptions({ files: [], zip: null, filesToSave: new Map(), fileTypes: [] });
    if (urdfFileInputRef.current) {
      urdfFileInputRef.current.value = '';
    }
  };


  return (
    <div className="LayerSettingsPanel">
      <div className="LayerSettingsPanelHeader">
        <h2>图层配置</h2>
        <div className="HeaderButtons">
          <button className="ResetButton" onClick={onResetToDefaults} type="button" title="恢复默认设置">
            恢复默认
          </button>
          <button className="CloseButton" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </div>
      <div className="LayerSettingsPanelContent">
        {/* 遥控管理部分 */}
        <div className="LayerItem">
          <div className="LayerItemHeader" onClick={() => toggleLayer('cmd_vel')}>
            <span className="LayerName">遥控</span>
            <div className="LayerControls">
              <span className="ExpandIcon">{expandedLayers.has('cmd_vel') ? '▼' : '▶'}</span>
            </div>
          </div>
          {expandedLayers.has('cmd_vel') && (
            <div className="LayerItemDetails" onClick={(e) => e.stopPropagation()}>
              {Object.entries(layerConfigs)
                .filter(([_, config]) => config.id === 'cmd_vel')
                .map(([layerId, config]) => (
                  <div key={layerId}>
                    <div className="DetailRow">
                      <span className="DetailLabel">话题:</span>
                      {isEditing(layerId, 'topic') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'topic', config.topic)}
                          onChange={(e) => updateEditingValue(layerId, 'topic', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'topic', config.topic);
                            handleFieldChange(layerId, 'topic', value || null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'topic', config.topic);
                              handleFieldChange(layerId, 'topic', value || null);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_topic`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_topic`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'topic', config.topic)}>
                          {config.topic || '(无)'}
                        </span>
                      )}
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">X轴速度 (前进/后退):</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={(config.linearXSpeed as number | undefined) ?? 0.5}
                          onChange={(e) => handleFieldChange(layerId, 'linearXSpeed', parseFloat(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ minWidth: '50px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.8)' }}>
                          {((config.linearXSpeed as number | undefined) ?? 0.5).toFixed(1)} m/s
                        </span>
                      </div>
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">Y轴速度 (左右移动):</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={(config.linearYSpeed as number | undefined) ?? 0.5}
                          onChange={(e) => handleFieldChange(layerId, 'linearYSpeed', parseFloat(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ minWidth: '50px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.8)' }}>
                          {((config.linearYSpeed as number | undefined) ?? 0.5).toFixed(1)} m/s
                        </span>
                      </div>
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">Z轴角速度 (旋转):</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={(config.angularZSpeed as number | undefined) ?? 0.5}
                          onChange={(e) => handleFieldChange(layerId, 'angularZSpeed', parseFloat(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ minWidth: '50px', textAlign: 'right', color: 'rgba(255, 255, 255, 0.8)' }}>
                          {((config.angularZSpeed as number | undefined) ?? 0.5).toFixed(1)} rad/s
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              {Object.entries(layerConfigs).filter(([_, config]) => config.id === 'cmd_vel').length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)' }}>
                  <p>暂无遥控配置</p>
                </div>
              )}
            </div>
          )}
        </div>
        {/* 重定位管理部分 */}
        <div className="LayerItem">
          <div className="LayerItemHeader" onClick={() => toggleLayer('initialpose')}>
            <span className="LayerName">重定位</span>
            <div className="LayerControls">
              <span className="ExpandIcon">{expandedLayers.has('initialpose') ? '▼' : '▶'}</span>
            </div>
          </div>
          {expandedLayers.has('initialpose') && (
            <div className="LayerItemDetails" onClick={(e) => e.stopPropagation()}>
              {Object.entries(layerConfigs)
                .filter(([_, config]) => config.id === 'initialpose')
                .map(([layerId, config]) => (
                  <div key={layerId}>
                    <div className="DetailRow">
                      <span className="DetailLabel">话题:</span>
                      {isEditing(layerId, 'topic') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'topic', config.topic)}
                          onChange={(e) => updateEditingValue(layerId, 'topic', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'topic', config.topic);
                            handleFieldChange(layerId, 'topic', value || null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'topic', config.topic);
                              handleFieldChange(layerId, 'topic', value || null);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_topic`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_topic`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="DetailValue"
                          onClick={() => startEditing(layerId, 'topic', config.topic)}
                        >
                          {config.topic || '-'}
                        </span>
                      )}
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">Base Frame:</span>
                      {isEditing(layerId, 'baseFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'baseFrame', (config as any).baseFrame)}
                          onChange={(e) => updateEditingValue(layerId, 'baseFrame', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'baseFrame', (config as any).baseFrame);
                            handleFieldChange(layerId, 'baseFrame', value || null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'baseFrame', (config as any).baseFrame);
                              handleFieldChange(layerId, 'baseFrame', value || null);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_baseFrame`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_baseFrame`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="DetailValue"
                          onClick={() => startEditing(layerId, 'baseFrame', (config as any).baseFrame)}
                        >
                          {(config as any).baseFrame || '-'}
                        </span>
                      )}
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">Map Frame:</span>
                      {isEditing(layerId, 'mapFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'mapFrame', (config as any).mapFrame)}
                          onChange={(e) => updateEditingValue(layerId, 'mapFrame', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'mapFrame', (config as any).mapFrame);
                            handleFieldChange(layerId, 'mapFrame', value || null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'mapFrame', (config as any).mapFrame);
                              handleFieldChange(layerId, 'mapFrame', value || null);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_mapFrame`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_mapFrame`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="DetailValue"
                          onClick={() => startEditing(layerId, 'mapFrame', (config as any).mapFrame)}
                        >
                          {(config as any).mapFrame || '-'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              {Object.entries(layerConfigs).filter(([_, config]) => config.id === 'initialpose').length === 0 && (
                <div style={{ padding: '10px', color: 'rgba(255, 255, 255, 0.5)' }}>
                  <p>暂无重定位配置</p>
                </div>
              )}
            </div>
          )}
        </div>
        {/* 图片管理部分 */}
        <div className="LayerItem">
          <div className="LayerItemHeader" onClick={() => toggleLayer('images')}>
            <span className="LayerName">图片</span>
            <div className="LayerControls">
              <button
                className="DetailButton"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAddImageDialog(true);
                  setNewImageTopic('');
                  setNewImageType('sensor_msgs/Image');
                }}
                type="button"
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginRight: '8px',
                }}
              >
                添加
              </button>
              <span className="ExpandIcon">{expandedLayers.has('images') ? '▼' : '▶'}</span>
            </div>
          </div>
          {expandedLayers.has('images') && (
            <div className="LayerItemDetails" onClick={(e) => e.stopPropagation()}>
              {Object.entries(layerConfigs)
                .filter(([_, config]) => config.id === 'image')
                .map(([layerId, config]) => (
                  <div key={layerId} style={{ marginBottom: '12px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                    <div className="DetailRow" style={{ marginBottom: '8px' }}>
                      <span className="DetailLabel">名称:</span>
                      {isEditing(layerId, 'name') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'name', config.name)}
                          onChange={(e) => updateEditingValue(layerId, 'name', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'name', config.name);
                            handleFieldChange(layerId, 'name', value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'name', config.name);
                              handleFieldChange(layerId, 'name', value);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_name`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_name`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'name', config.name)}>
                          {config.name || '(无)'}
                        </span>
                      )}
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">话题:</span>
                      {isEditing(layerId, 'topic') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={config.topic || ''}
                          onChange={(e) => handleFieldChange(layerId, 'topic', e.target.value || null)}
                          onBlur={() => setEditingFields((prev) => {
                            const next = new Map(prev);
                            next.delete(`${layerId}_topic`);
                            return next;
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleFieldChange(layerId, 'topic', (e.target as HTMLInputElement).value || null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'topic', config.topic)}>
                          {config.topic || '(无)'}
                        </span>
                      )}
                    </div>
                    <div className="DetailRow">
                      <span className="DetailLabel">类型:</span>
                      <select
                        className="DetailSelect"
                        value={(config.messageType as string | undefined) || 'sensor_msgs/Image'}
                        onChange={(e) => handleFieldChange(layerId, 'messageType', e.target.value)}
                      >
                        <option value="sensor_msgs/Image">sensor_msgs/Image</option>
                        <option value="sensor_msgs/CompressedImage">sensor_msgs/CompressedImage</option>
                      </select>
                    </div>
                    <div className="DetailRow" style={{ marginTop: '8px' }}>
                      <label className="ToggleSwitch">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(e) => handleToggleEnabled(layerId, e.target.checked)}
                        />
                        <span>显示</span>
                      </label>
                      {onDeleteLayer && (
                        <button
                          className="DetailButton"
                          onClick={() => {
                            if (confirm(`确定要删除图层 "${config.name}" 吗？`)) {
                              onDeleteLayer(layerId);
                            }
                          }}
                          type="button"
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: 'rgba(255, 107, 107, 0.2)',
                            color: '#ff6b6b',
                            border: '1px solid rgba(255, 107, 107, 0.3)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            marginLeft: 'auto',
                          }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              {Object.entries(layerConfigs).filter(([_, config]) => config.id === 'image').length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)' }}>
                  <p>暂无图片图层</p>
                </div>
              )}
            </div>
          )}
        </div>
        {/* URDF 管理部分 */}
        <div className="LayerItem">
          <div className="LayerItemHeader" onClick={() => toggleLayer('urdf')}>
            <span className="LayerName">URDF 管理</span>
            <div className="LayerControls">
              <span className="ExpandIcon">{expandedLayers.has('urdf') ? '▼' : '▶'}</span>
            </div>
          </div>
          {expandedLayers.has('urdf') && (
            <div className="LayerItemDetails" onClick={(e) => e.stopPropagation()}>
              <div style={{ marginBottom: '12px' }}>
                <button
                  className="DetailButton"
                  onClick={handleUrdfUpload}
                  type="button"
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  📤 上传 URDF 文件（ZIP 压缩包）
                </button>
              </div>
              <input
                ref={urdfFileInputRef}
                type="file"
                accept=".urdf,.URDF,.zip,.ZIP"
                style={{ display: 'none' }}
                onChange={handleUrdfFileSelect}
              />
              {urdfConfigs.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)' }}>
                  <p>暂无已上传的 URDF 文件</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {urdfConfigs.map((config) => (
                    <div
                      key={config.id}
                      style={{
                        padding: '12px',
                        backgroundColor: currentUrdfId === config.id ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${currentUrdfId === config.id ? '#4CAF50' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                backgroundColor: '#4CAF50',
                                color: 'white',
                              }}
                            >
                              URDF
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>{config.fileName}</span>
                            {currentUrdfId === config.id && (
                              <span
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  backgroundColor: '#4CAF50',
                                  color: 'white',
                                }}
                              >
                                当前使用
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
                            {Object.keys(config.packages).length} 个包
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {currentUrdfId !== config.id && (
                          <button
                            onClick={() => handleUrdfSelect(config.id)}
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              backgroundColor: '#2196F3',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                            type="button"
                          >
                            使用
                          </button>
                        )}
                        <button
                          onClick={() => handleUrdfDelete(config)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            backgroundColor: 'rgba(255, 107, 107, 0.2)',
                            color: '#ff6b6b',
                            border: '1px solid rgba(255, 107, 107, 0.3)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {Object.entries(layerConfigs)
          .filter(([_, config]) => config.id !== 'image' && config.id !== 'cmd_vel')
          .map(([layerId, config]) => (
          <div key={layerId} className="LayerItem">
            <div className="LayerItemHeader" onClick={() => toggleLayer(layerId)}>
              <span className="LayerName">{config.name}</span>
              <div className="LayerControls">
                <label className="ToggleSwitch">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => handleToggleEnabled(layerId, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>显示</span>
                </label>
                <span className="ExpandIcon">{expandedLayers.has(layerId) ? '▼' : '▶'}</span>
              </div>
            </div>
              {expandedLayers.has(layerId) && (
                <div className="LayerItemDetails" onClick={(e) => e.stopPropagation()}>
                  <div className="DetailRow">
                    <span className="DetailLabel">ID:</span>
                    <span className="DetailValue">{config.id}</span>
                  </div>
                  {config.topic !== null && (
                    <div className="DetailRow">
                      <span className="DetailLabel">话题:</span>
                      {isEditing(layerId, 'topic') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={config.topic || ''}
                          onChange={(e) => handleFieldChange(layerId, 'topic', e.target.value || null)}
                          onBlur={() => setEditingFields((prev) => {
                            const next = new Map(prev);
                            next.delete(`${layerId}_topic`);
                            return next;
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleFieldChange(layerId, 'topic', (e.target as HTMLInputElement).value || null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'topic', config.topic)}>
                          {config.topic || '(无)'}
                        </span>
                      )}
                    </div>
                  )}
                  {(config.colorMode as ColorModes | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">颜色模式:</span>
                      <select
                        className="DetailSelect"
                        value={(config.colorMode as ColorModes | undefined) || 'map'}
                        onChange={(e) => handleFieldChange(layerId, 'colorMode', e.target.value as ColorModes)}
                      >
                        <option value="map">Map</option>
                        <option value="costmap">Costmap</option>
                        <option value="raw">Raw</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  )}
                  {(config.alpha as number | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">透明度:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={(config.alpha as number | undefined) ?? 1.0}
                        onChange={(e) => handleFieldChange(layerId, 'alpha', parseFloat(e.target.value))}
                      />
                    </div>
                  )}
                  {(config.height as number | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">高度:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        step="0.00001"
                        value={(config.height as number | undefined) ?? 0}
                        onChange={(e) => handleFieldChange(layerId, 'height', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )}
                  {(config.targetFrame as string | undefined) && (
                    <div className="DetailRow">
                      <span className="DetailLabel">目标坐标系:</span>
                      {isEditing(layerId, 'targetFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'targetFrame', config.targetFrame as string | undefined)}
                          onChange={(e) => updateEditingValue(layerId, 'targetFrame', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'targetFrame', config.targetFrame as string | undefined);
                            handleFieldChange(layerId, 'targetFrame', value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'targetFrame', config.targetFrame as string | undefined);
                              handleFieldChange(layerId, 'targetFrame', value);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_targetFrame`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_targetFrame`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'targetFrame', config.targetFrame as string | undefined)}>
                          {config.targetFrame as string | undefined}
                        </span>
                      )}
                    </div>
                  )}
                  {(config.baseFrame as string | undefined) && (
                    <div className="DetailRow">
                      <span className="DetailLabel">基础坐标系:</span>
                      {isEditing(layerId, 'baseFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'baseFrame', config.baseFrame as string | undefined)}
                          onChange={(e) => updateEditingValue(layerId, 'baseFrame', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'baseFrame', config.baseFrame as string | undefined);
                            handleFieldChange(layerId, 'baseFrame', value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'baseFrame', config.baseFrame as string | undefined);
                              handleFieldChange(layerId, 'baseFrame', value);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_baseFrame`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_baseFrame`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'baseFrame', config.baseFrame as string | undefined)}>
                          {config.baseFrame as string | undefined}
                        </span>
                      )}
                    </div>
                  )}
                  {(config.mapFrame as string | undefined) && (
                    <div className="DetailRow">
                      <span className="DetailLabel">地图坐标系:</span>
                      {isEditing(layerId, 'mapFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={getEditingValue(layerId, 'mapFrame', config.mapFrame as string | undefined)}
                          onChange={(e) => updateEditingValue(layerId, 'mapFrame', e.target.value)}
                          onBlur={() => {
                            const value = getEditingValue(layerId, 'mapFrame', config.mapFrame as string | undefined);
                            handleFieldChange(layerId, 'mapFrame', value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = getEditingValue(layerId, 'mapFrame', config.mapFrame as string | undefined);
                              handleFieldChange(layerId, 'mapFrame', value);
                            }
                            if (e.key === 'Escape') {
                              setEditingFields((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_mapFrame`);
                                return next;
                              });
                              setEditingValues((prev) => {
                                const next = new Map(prev);
                                next.delete(`${layerId}_mapFrame`);
                                return next;
                              });
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'mapFrame', config.mapFrame as string | undefined)}>
                          {(config as any).mapFrame}
                        </span>
                      )}
                    </div>
                  )}
                  {(config.followZoomFactor as number | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">跟随缩放倍数:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        min="0.01"
                        max="1"
                        step="0.01"
                        value={(config.followZoomFactor as number | undefined) ?? 0.3}
                        onChange={(e) => handleFieldChange(layerId, 'followZoomFactor', parseFloat(e.target.value) || 0.3)}
                      />
                      <span className="DetailHint">（越小越放大，范围：0.01-1）</span>
                    </div>
                  )}
                  {(config.color as number | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">颜色:</span>
                      <input
                        className="DetailInput ColorInput"
                        type="color"
                        value={`#${((config.color as number | undefined) ?? 0x0000ff).toString(16).padStart(6, '0')}`}
                        onChange={(e) => handleFieldChange(layerId, 'color', parseInt(e.target.value.substring(1), 16))}
                      />
                    </div>
                  )}
                  {(config.pointSize as number | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">点大小:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        min="0.01"
                        max="2"
                        step="0.01"
                        value={(config.pointSize as number | undefined) ?? 0.3}
                        onChange={(e) => handleFieldChange(layerId, 'pointSize', parseFloat(e.target.value) || 0.3)}
                      />
                    </div>
                  )}
                  {layerId === 'tf' && (config.showFrameNames as boolean | undefined) !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">显示frame名称:</span>
                      <label className="ToggleSwitch">
                        <input
                          type="checkbox"
                          checked={(config.showFrameNames as boolean | undefined) !== false}
                          onChange={(e) => handleFieldChange(layerId, 'showFrameNames', e.target.checked)}
                        />
                        <span>{(config.showFrameNames as boolean | undefined) !== false ? '是' : '否'}</span>
                      </label>
                    </div>
                  )}
                  {layerId === 'tf' && (
                    <div className="DetailRow" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span className="DetailLabel" style={{ marginBottom: '8px' }}>坐标系显示:</span>
                      <div style={{ 
                        width: '100%', 
                        maxHeight: '200px', 
                        overflowY: 'auto',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        padding: '8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)'
                      }}>
                        {tfFrames.length === 0 ? (
                          <div style={{ padding: '10px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>
                            暂无坐标系
                          </div>
                        ) : (
                          tfFrames.map((frameId) => {
                            const enabledFrames = new Set((config.enabledFrames as string[] | undefined) || []);
                            const isEnabled = enabledFrames.size === 0 || enabledFrames.has(frameId);
                            return (
                              <label
                                key={frameId}
                                className="ToggleSwitch"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '4px 0',
                                  cursor: 'pointer',
                                }}
                              >
                                <span style={{ fontSize: '12px', flex: 1 }}>{frameId}</span>
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={(e) => handleTfFrameToggle(layerId, frameId, e.target.checked)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <span style={{ fontSize: '11px', marginLeft: '8px' }}>{isEnabled ? '显示' : '隐藏'}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        ))}
      </div>
      {showUrdfSelector && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 10002,
            }}
            onClick={handleUrdfFileSelectCancel}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(30, 30, 30, 0.98)',
              padding: '20px',
              borderRadius: '8px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              zIndex: 10003,
              minWidth: '400px',
              maxWidth: '600px',
              color: 'white',
            }}
          >
            <div style={{ marginBottom: '15px' }}>
              <h3 style={{ margin: '0 0 10px 0', color: 'white' }}>选择主文件</h3>
              <p style={{ margin: '0', color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px' }}>
                检测到多个 URDF 文件，请选择要使用的主文件：
              </p>
            </div>
            <div style={{ marginBottom: '15px', maxHeight: '300px', overflowY: 'auto' }}>
              {urdfFileOptions.files.map((fileName) => {
                const fileType = 'urdf' as const;
                return (
                  <button
                    key={fileName}
                    onClick={() => handleUrdfFileSelectConfirm(fileName)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '10px',
                      marginBottom: '8px',
                      textAlign: 'left',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: 'white',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    }}
                    type="button"
                  >
                    <span style={{ fontWeight: 'bold', color: '#4CAF50' }}>
                      [{fileType.toUpperCase()}]
                    </span> {fileName}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={handleUrdfFileSelectCancel}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                }}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        </>
      )}
      {showAddImageDialog && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 10002,
            }}
            onClick={() => setShowAddImageDialog(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(30, 30, 30, 0.98)',
              padding: '20px',
              borderRadius: '8px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              zIndex: 10003,
              minWidth: '400px',
              maxWidth: '600px',
              color: 'white',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '15px' }}>
              <h3 style={{ margin: '0 0 10px 0', color: 'white' }}>添加图片图层</h3>
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                话题名称:
              </label>
              <input
                type="text"
                value={newImageTopic}
                onChange={(e) => setNewImageTopic(e.target.value)}
                placeholder="/camera/image_raw"
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                }}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                消息类型:
              </label>
              <select
                value={newImageType}
                onChange={(e) => setNewImageType(e.target.value as 'sensor_msgs/Image' | 'sensor_msgs/CompressedImage')}
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                }}
              >
                <option value="sensor_msgs/Image">sensor_msgs/Image</option>
                <option value="sensor_msgs/CompressedImage">sensor_msgs/CompressedImage</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowAddImageDialog(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                }}
                type="button"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (newImageTopic.trim()) {
                    const newLayerId = `image_${Date.now()}`;
                    onConfigChange(newLayerId, {
                      id: 'image',
                      name: `图片 ${Object.keys(layerConfigs).filter(k => layerConfigs[k]?.id === 'image').length + 1}`,
                      topic: newImageTopic.trim(),
                      messageType: newImageType,
                      enabled: true,
                    });
                    setShowAddImageDialog(false);
                    setNewImageTopic('');
                    setNewImageType('sensor_msgs/Image');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2196F3',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

