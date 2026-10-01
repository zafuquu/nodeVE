import React, { useMemo, useState } from 'react';
import { Handle, Position, useEdges, useNodes } from '@xyflow/react';
import { resolveMergeLayers } from '../utils/graphLayers';
import NodeHeader from '../components/NodeHeader';

export default function MergeNode({ id, data, selected }) {
  const allEdges = useEdges();
  const allNodes = useNodes();
  const [minHandles] = useState(4);

  const connectedHandles = useMemo(() => {
    return allEdges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.targetHandle);
  }, [allEdges, id]);

  const handleCount = useMemo(() => {
    const maxConnected = connectedHandles.reduce((max, handle) => {
      const idx = parseInt(handle?.split('-')[1] || '0', 10);
      return Math.max(max, idx);
    }, 0);
    return Math.max(minHandles, maxConnected + 1);
  }, [connectedHandles, minHandles]);

  const handles = useMemo(() => {
    const arr = [];
    for (let i = 1; i <= handleCount; i += 1) {
      arr.push({
        id: `in-${i}`,
        label: `Layer ${i}`,
        connected: connectedHandles.includes(`in-${i}`),
      });
    }
    return arr;
  }, [handleCount, connectedHandles]);

  const nodeDataSerialized = useMemo(() => {
    return JSON.stringify(allNodes.map(n => ({ id: n.id, type: n.type, data: n.data })));
  }, [allNodes]);

  const layerObjects = useMemo(() => {
    const sourceNode = allNodes.find((node) => node.type === 'source');
    return resolveMergeLayers(allNodes, allEdges, id, {
      srcW: sourceNode?.data?.width || 1920,
      srcH: sourceNode?.data?.height || 1080,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDataSerialized, allEdges, id]);

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <NodeHeader
        type="merge"
        label="MERGE"
        icon="+"
        onDelete={() => data.deleteNode?.(id)}
        disabled={data.disabled}
        onToggleDisabled={(val) => data.updateNodeData?.(id, { disabled: val })}
      />


      <div className="cf-node-body">
        <div style={{ padding: '4px 0' }}>
          {handles.map((handle, i) => {
            const layer = layerObjects.find((item) => item.inputHandle === handle.id);
            return (
              <div
                key={handle.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: handle.connected ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderLeft: `2px solid ${handle.connected ? 'var(--color-accent)' : 'transparent'}`,
                  transition: 'all 0.15s ease',
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={handle.id}
                  style={{
                    left: '-14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: handle.connected ? 'var(--color-accent)' : 'var(--border-subtle)',
                    border: '1px solid #111',
                    width: '8px',
                    height: '8px',
                  }}
                  title={`${handle.label} input`}
                />
                <span>{layer ? `Layer ${layer.order + 1}` : handle.label}</span>
                {layer ? (
                  <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {layer.maskNodeId ? `${layer.localMaskRects.length} mask` : 'crop'} / {layer.transformNodeId}
                  </span>
                ) : (
                  handle.connected && <span style={{ fontSize: '8px', color: 'var(--color-accent)', marginLeft: 'auto' }}>connected</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          padding: '4px 0',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {layerObjects.length} LAYERS / {connectedHandles.length} INPUTS
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Merged video output" />
    </div>
  );
}
