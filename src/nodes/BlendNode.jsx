import React from 'react';
import { Handle, Position } from '@xyflow/react';
import NodeHeader from '../components/NodeHeader';

export default function BlendNode({ id, data, selected }) {
  return (
    <div className={`cf-node ${selected ? 'selected' : ''}`}>
      {/* Multiple input handles for layering */}
      <Handle type="target" position={Position.Left} id="bg-in" style={{ top: '30%' }} title="Background (Blur)" />
      <Handle type="target" position={Position.Left} id="layer1-in" style={{ top: '50%' }} title="Layer 1" />
      <Handle type="target" position={Position.Left} id="layer2-in" style={{ top: '70%' }} title="Layer 2" />

      <NodeHeader type="blend" label="BLEND" onDelete={() => data.deleteNode?.(id)} />

      <div className="cf-node-body">
        <div className="cf-node-preview" style={{ aspectRatio: '9 / 16', maxHeight: '200px' }}>
          <svg width="100%" height="100%" viewBox="0 0 90 160">
            <rect width="90" height="160" fill="#0a0a12" />
            <rect x="5" y="5" width="80" height="150" rx="3"
              fill="rgba(41, 128, 185, 0.15)"
              stroke="var(--color-blur)" strokeWidth="0.8" strokeDasharray="3 2" />
            <text x="45" y="85" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="7" fontFamily="var(--font-mono)">BG</text>
            <rect x="10" y="25" width="70" height="45" rx="2"
              fill="rgba(0, 200, 150, 0.2)" stroke="var(--color-source)" strokeWidth="1" />
            <text x="45" y="50" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="6" fontFamily="var(--font-mono)">Layer 1</text>
            <rect x="15" y="110" width="60" height="35" rx="2"
              fill="rgba(232, 67, 147, 0.2)" stroke="var(--color-blend)" strokeWidth="1" />
            <text x="45" y="130" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="6" fontFamily="var(--font-mono)">Layer 2</text>
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            { label: 'Background', color: 'var(--color-blur)', value: '30%' },
            { label: 'Layer 1', color: 'var(--color-source)', value: '50%' },
            { label: 'Layer 2', color: 'var(--color-blend)', value: '70%' },
          ].map(({ label, color, value }) => (
            <div className="cf-info-row" key={label}>
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block' }} />
                {label}
              </span>
              <span className="info-value">{value}</span>
            </div>
          ))}
        </div>

        <div className="cf-info-row" style={{ paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
          <span className="info-label">Final Output</span>
          <span className="info-value">1080×1920</span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Blended video output" />
    </div>
  );
}
