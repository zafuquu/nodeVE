import React, { useMemo } from 'react';
import { Handle, Position, useEdges, useNodes } from '@xyflow/react';
import { useVideoState } from '../context/VideoProvider';
import { resolveOutputLayers } from '../utils/graphLayers';
import NodeHeader from '../components/NodeHeader';

export default function OutputNode({ id, data, selected }) {
  const { srcW, srcH } = useVideoState();
  const nodes = useNodes();
  const edges = useEdges();
  const isConnected = data._isConnected;

  const { layers } = useMemo(() => {
    return resolveOutputLayers(nodes, edges, id, { srcW, srcH });
  }, [nodes, edges, id, srcW, srcH]);

  return (
    <div className={`cf-node output-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="final-in" style={{ top: '50%' }} title="Final composited input" />

      <NodeHeader type="output" label="OUTPUT" onDelete={() => data.deleteNode?.(id)} />

      <div className="cf-node-body output-node-body">
        <div className="cf-info-row">
          <span className="info-label">Display</span>
          <span className="info-value">9:16</span>
        </div>
        <div className="cf-info-row">
          <span className="info-label">Layers</span>
          <span className="info-value">{layers.length}</span>
        </div>
        <div className="cf-info-row">
          <span className="info-label">Frame Rate</span>
          <span className="info-value">60 fps</span>
        </div>
        <div className="cf-info-row" style={{ paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
          <span className="info-label">Codec</span>
          <span className="info-value" style={{ color: '#2ecc71' }}>NVENC</span>
        </div>
      </div>
    </div>
  );
}
