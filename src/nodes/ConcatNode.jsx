import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';

export default function ConcatNode({ id, data, selected }) {
  const { handleDelete } = useNodeData(id, data);

  return (
    <div className={`cf-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: '20%' }} title="Clip 1 Input" />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: '40%' }} title="Clip 2 Input" />
      <Handle type="target" position={Position.Left} id="in-3" style={{ top: '60%' }} title="Clip 3 Input" />
      <Handle type="target" position={Position.Left} id="in-4" style={{ top: '80%' }} title="Clip 4 Input" />

      <NodeHeader type="concat" label="CONCAT SEQUENCE" onDelete={handleDelete} />

      <div className="cf-node-body">
        <div style={{ padding: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
            Sequential Engine
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ background: '#141414', padding: '6px', border: '1px solid var(--border-default)', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>[1]</span>
              <span>Input Track 1</span>
            </div>
            <div style={{ background: '#141414', padding: '6px', border: '1px solid var(--border-default)', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>[2]</span>
              <span>Input Track 2</span>
            </div>
            <div style={{ background: '#141414', padding: '6px', border: '1px solid var(--border-default)', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>[3]</span>
              <span>Input Track 3</span>
            </div>
            <div style={{ background: '#141414', padding: '6px', border: '1px solid var(--border-default)', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>[4]</span>
              <span>Input Track 4</span>
            </div>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Concat Video Out" />
    </div>
  );
}
