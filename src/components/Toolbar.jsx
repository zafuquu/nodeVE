import React, { useCallback, useState, useEffect } from 'react';

export default function Toolbar({ gpuInfo, onExport, onSave, onLoad, onLoadPreset, paletteItems }) {
  const [presets, setPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('');

  const loadPresetsList = useCallback(async () => {
    if (window.clipForge?.getPresets) {
      try {
        const list = await window.clipForge.getPresets();
        setPresets(list || []);
      } catch (err) {
        console.error('[Toolbar] Error fetching presets:', err);
      }
    }
  }, []);

  useEffect(() => {
    loadPresetsList();
  }, [loadPresetsList]);

  const onDragStart = useCallback((event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleSelectPreset = async (e) => {
    const val = e.target.value;
    if (!val) return;

    if (val === 'browse') {
      onLoad();
      setSelectedPreset('');
      return;
    }

    setSelectedPreset(val);
    if (window.clipForge?.loadPreset) {
      try {
        const flow = await window.clipForge.loadPreset(val);
        if (flow) {
          onLoadPreset(flow);
        } else {
          alert('Failed to load preset');
        }
      } catch (err) {
        console.error('[Toolbar] Error loading preset:', err);
        alert('Error loading preset');
      }
    }
    setSelectedPreset('');
  };

  return (
    <div className="toolbar">
      {/* Branding — matches reference "DCOMP" position */}
      <span className="toolbar-logo">AKUMAUI</span>
      <div className="toolbar-divider" />

      {/* Node palette — drag to canvas */}
      <div className="toolbar-section node-palette">
        {paletteItems.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            title={`Drag to add ${item.label} node`}
          >
            <span className="palette-dot" style={{ background: item.color }} />
            {item.label}
          </div>
        ))}
      </div>

      <div className="toolbar-spacer" />

      {/* GPU status badge */}
      <div className={`gpu-badge ${gpuInfo.available ? 'available' : ''}`}>
        <span className="gpu-dot" />
        {gpuInfo.available ? gpuInfo.gpuName || 'NVENC' : 'CPU Mode'}
      </div>

      <div className="toolbar-divider" />

      {/* Action buttons — matches reference SAVE PRESET / LOAD PRESET */}
      <div className="toolbar-section">
        <button className="toolbar-btn save-preset" onClick={onSave} title="Save preset">
          SAVE PRESET
        </button>

        <div className="preset-select-wrapper">
          <select
            className="toolbar-select load-preset"
            value={selectedPreset}
            onChange={handleSelectPreset}
            title="Load a preset template"
          >
            <option value="" disabled>SELECT PRESET...</option>
            {presets.map((preset) => (
              <option key={preset} value={preset}>
                {preset.replace('.json', '').replace(/_/g, ' ')}
              </option>
            ))}
            <option value="browse">Browse File...</option>
          </select>
        </div>

        <button className="toolbar-btn export-btn" onClick={onExport} title="Export video">
          Export
        </button>
      </div>
    </div>
  );
}
