import { useState } from 'react';
import type { LayerConfigMap } from '../types/LayerConfig';
import type { ColorModes } from '../utils/colorUtils';
import './LayerSettingsPanel.css';

interface LayerSettingsPanelProps {
  layerConfigs: LayerConfigMap;
  onConfigChange: (layerId: string, config: Partial<import('../types/LayerConfig').LayerConfig>) => void;
  onClose: () => void;
}

export function LayerSettingsPanel({ layerConfigs, onConfigChange, onClose }: LayerSettingsPanelProps) {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [editingFields, setEditingFields] = useState<Map<string, string>>(new Map());

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
  };

  const startEditing = (layerId: string, field: string) => {
    setEditingFields((prev) => new Map(prev).set(`${layerId}_${field}`, field));
  };

  const isEditing = (layerId: string, field: string): boolean => {
    return editingFields.get(`${layerId}_${field}`) === field;
  };

  return (
    <div className="LayerSettingsPanel">
      <div className="LayerSettingsPanelHeader">
        <h2>图层配置</h2>
        <button className="CloseButton" onClick={onClose} type="button">
          ×
        </button>
      </div>
      <div className="LayerSettingsPanelContent">
        {Object.entries(layerConfigs).map(([layerId, config]) => (
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
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'topic')}>
                          {config.topic || '(无)'}
                        </span>
                      )}
                    </div>
                  )}
                  {(config as any).colorMode !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">颜色模式:</span>
                      <select
                        className="DetailSelect"
                        value={(config as any).colorMode || 'map'}
                        onChange={(e) => handleFieldChange(layerId, 'colorMode', e.target.value as ColorModes)}
                      >
                        <option value="map">Map</option>
                        <option value="costmap">Costmap</option>
                        <option value="raw">Raw</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  )}
                  {(config as any).alpha !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">透明度:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={(config as any).alpha ?? 1.0}
                        onChange={(e) => handleFieldChange(layerId, 'alpha', parseFloat(e.target.value))}
                      />
                    </div>
                  )}
                  {(config as any).height !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">高度:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        step="0.00001"
                        value={(config as any).height ?? 0}
                        onChange={(e) => handleFieldChange(layerId, 'height', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )}
                  {(config as any).targetFrame && (
                    <div className="DetailRow">
                      <span className="DetailLabel">目标坐标系:</span>
                      {isEditing(layerId, 'targetFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={(config as any).targetFrame || ''}
                          onChange={(e) => handleFieldChange(layerId, 'targetFrame', e.target.value)}
                          onBlur={() => setEditingFields((prev) => {
                            const next = new Map(prev);
                            next.delete(`${layerId}_targetFrame`);
                            return next;
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleFieldChange(layerId, 'targetFrame', (e.target as HTMLInputElement).value);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'targetFrame')}>
                          {(config as any).targetFrame}
                        </span>
                      )}
                    </div>
                  )}
                  {(config as any).baseFrame && (
                    <div className="DetailRow">
                      <span className="DetailLabel">基础坐标系:</span>
                      {isEditing(layerId, 'baseFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={(config as any).baseFrame || ''}
                          onChange={(e) => handleFieldChange(layerId, 'baseFrame', e.target.value)}
                          onBlur={() => setEditingFields((prev) => {
                            const next = new Map(prev);
                            next.delete(`${layerId}_baseFrame`);
                            return next;
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleFieldChange(layerId, 'baseFrame', (e.target as HTMLInputElement).value);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'baseFrame')}>
                          {(config as any).baseFrame}
                        </span>
                      )}
                    </div>
                  )}
                  {(config as any).mapFrame && (
                    <div className="DetailRow">
                      <span className="DetailLabel">地图坐标系:</span>
                      {isEditing(layerId, 'mapFrame') ? (
                        <input
                          className="DetailInput"
                          type="text"
                          value={(config as any).mapFrame || ''}
                          onChange={(e) => handleFieldChange(layerId, 'mapFrame', e.target.value)}
                          onBlur={() => setEditingFields((prev) => {
                            const next = new Map(prev);
                            next.delete(`${layerId}_mapFrame`);
                            return next;
                          })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleFieldChange(layerId, 'mapFrame', (e.target as HTMLInputElement).value);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="DetailValue Editable" onClick={() => startEditing(layerId, 'mapFrame')}>
                          {(config as any).mapFrame}
                        </span>
                      )}
                    </div>
                  )}
                  {(config as any).color !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">颜色:</span>
                      <input
                        className="DetailInput ColorInput"
                        type="color"
                        value={`#${((config as any).color ?? 0x0000ff).toString(16).padStart(6, '0')}`}
                        onChange={(e) => handleFieldChange(layerId, 'color', parseInt(e.target.value.substring(1), 16))}
                      />
                    </div>
                  )}
                  {(config as any).pointSize !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">点大小:</span>
                      <input
                        className="DetailInput NumberInput"
                        type="number"
                        min="0.01"
                        max="2"
                        step="0.01"
                        value={(config as any).pointSize ?? 0.3}
                        onChange={(e) => handleFieldChange(layerId, 'pointSize', parseFloat(e.target.value) || 0.3)}
                      />
                    </div>
                  )}
                  {layerId === 'tf' && (config as any).showFrameNames !== undefined && (
                    <div className="DetailRow">
                      <span className="DetailLabel">显示frame名称:</span>
                      <label className="ToggleSwitch">
                        <input
                          type="checkbox"
                          checked={(config as any).showFrameNames !== false}
                          onChange={(e) => handleFieldChange(layerId, 'showFrameNames', e.target.checked)}
                        />
                        <span>{(config as any).showFrameNames !== false ? '是' : '否'}</span>
                      </label>
                    </div>
                  )}
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

