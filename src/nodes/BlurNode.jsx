import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';
import AdvancedSlider from '../components/AdvancedSlider';

export default function BlurNode({ id, data, selected }) {
  const { handleChange, handleDelete } = useNodeData(id, data);
  const { radius = 20, stretch = true } = data;

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '50%' }} title="Video input" />
      <NodeHeader
        type="blur"
        label="BLUR"
        onDelete={handleDelete}
        disabled={data.disabled}
        onToggleDisabled={(val) => handleChange('disabled', val)}
      />
      <div className="cf-node-body">
        <div className="cf-node-preview">
          <svg width="100%" height="100%" viewBox="0 0 252 142">
            <defs>
              <filter id={`preview-blur-${id}`}>
                <feGaussianBlur stdDeviation={Math.min(radius / 2, 15)} />
              </filter>
              <linearGradient id={`blur-grad-${id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1a2a3a" />
                <stop offset="50%" stopColor="#0f1520" />
                <stop offset="100%" stopColor="#1a1a2e" />
              </linearGradient>
            </defs>
            <rect width="252" height="142" fill="#0a0a12" />
            <g filter={`url(#preview-blur-${id})`}>
              <rect x="20" y="20" width="80" height="50" rx="4" fill="#2ecc71" opacity="0.6" />
              <rect x="60" y="50" width="120" height="60" rx="4" fill="#3498db" opacity="0.5" />
              <circle cx="180" cy="50" r="25" fill="#e74c3c" opacity="0.5" />
              <rect x="150" y="90" width="80" height="35" rx="4" fill="#f39c12" opacity="0.4" />
            </g>
            <text x="126" y="130" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="var(--font-mono)">
              blur: {radius}px
            </text>
          </svg>
        </div>
        <div className="cf-slider-group">
          <AdvancedSlider label="Radius" value={radius} min={0} max={80} step={1} defaultValue={20} onChange={v => handleChange('radius', v)} suffix="px" />
        </div>
        <label className="cf-checkbox-row">
          <input type="checkbox" className="cf-checkbox nodrag" checked={stretch}
            onChange={(e) => handleChange('stretch', e.target.checked)} />
          Stretch to fill 9:16 background
        </label>
        <div className="cf-info-row">
          <span className="info-label">Output</span>
          <span className="info-value">1080×1920</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Blurred video output" />
    </div>
  );
}
