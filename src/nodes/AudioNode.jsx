import React, { useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';

export default function AudioNode({ id, data, selected }) {
  const { handleChange, handleDelete } = useNodeData(id, data);
  const volume = data.volume ?? 50;
  const offset = data.offset ?? 0;

  const handleBrowseAudio = useCallback(async () => {
    if (!window.clipForge?.openFile) {
      handleChange('filename', 'synthwave_beat.mp3');
      handleChange('filepath', 'C:/Music/synthwave_beat.mp3');
      handleChange('duration', 180);
      return;
    }
    const filepath = await window.clipForge.openFile();
    if (filepath) {
      const filename = filepath.split(/[\\/]/).pop();
      handleChange('filename', filename);
      handleChange('filepath', filepath);
      handleChange('duration', 180); // Fallback or probe duration if possible
    }
  }, [handleChange]);

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <NodeHeader
        type="audio"
        label="BACKGROUND MUSIC"
        onDelete={handleDelete}
        disabled={data.disabled}
        onToggleDisabled={(val) => handleChange('disabled', val)}
      />

      <div className="cf-node-body">
        {data.filename ? (
          <>
            <div className="cf-file-info">
              <span className="filename" style={{ color: 'var(--color-accent)' }}>{data.filename}</span>
            </div>
            
            <div className="cf-slider-group" style={{ marginTop: '6px' }}>
              <div className="cf-slider-row">
                <span className="cf-slider-label">Volume</span>
                <input
                  type="range"
                  className="cf-slider nodrag"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={(e) => handleChange('volume', Number(e.target.value))}
                />
                <span className="cf-slider-value precision-slider-val">{volume}%</span>
              </div>

              <div className="cf-slider-row">
                <span className="cf-slider-label">Offset</span>
                <input
                  type="range"
                  className="cf-slider nodrag"
                  min="0"
                  max="60"
                  step="0.5"
                  value={offset}
                  onChange={(e) => handleChange('offset', Number(e.target.value))}
                />
                <span className="cf-slider-value precision-slider-val">{offset}s</span>
              </div>
            </div>

            <button className="cf-node-btn nodrag" onClick={handleBrowseAudio} style={{ marginTop: '8px' }}>
              Change Music File…
            </button>
          </>
        ) : (
          <button className="cf-node-btn nodrag" onClick={handleBrowseAudio}>
            Load Audio File…
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="audio-out" style={{ top: '50%' }} title="Audio Out" />
    </div>
  );
}
