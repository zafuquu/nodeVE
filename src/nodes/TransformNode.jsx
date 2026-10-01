import React, { useRef, useEffect, useMemo } from 'react';
import { Handle, Position, useEdges, useNodes } from '@xyflow/react';
import { useVideoState } from '../context/VideoProvider';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';
import AdvancedSlider from '../components/AdvancedSlider';
import { resolveTransformLayer } from '../utils/graphLayers';
import { drawLayerToCanvas } from '../utils/canvasCompositor';

export default function TransformNode({ id, data, selected }) {
  const { videoReady, subscribe, srcW, srcH } = useVideoState();
  const nodes = useNodes();
  const edges = useEdges();
  const canvasRef = useRef(null);
  const { handleChange, handleDelete } = useNodeData(id, data);

  const { scaleX = 100, scaleY = 100, rotation = 0, posX = 50, posY = 50, lockAspect = true } = data;
  const isConnected = data._isConnected;

  const nodeDataSerialized = useMemo(() => {
    return JSON.stringify(nodes.map(n => ({ id: n.id, type: n.type, data: n.data })));
  }, [nodes]);

  const layerObject = useMemo(() => {
    return resolveTransformLayer(nodes, edges, id, { srcW, srcH });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDataSerialized, edges, id, srcW, srcH]);

  useEffect(() => {
    if (!videoReady || !canvasRef.current || !isConnected || !layerObject) return undefined;
    const unsub = subscribe((vid) => {
      if (!vid || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const cw = canvasRef.current.width;
      const ch = canvasRef.current.height;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
      ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
      ctx.stroke();
      drawLayerToCanvas(ctx, vid, layerObject, cw, ch, { debugStroke: '#3498db', debugLineWidth: 1.5 });
    });
    return unsub;
  }, [videoReady, subscribe, isConnected, layerObject]);

  const handleScaleX = (v) => {
    handleChange('scaleX', v);
    if (lockAspect) handleChange('scaleY', v);
  };

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '50%' }} title="Video input" />
      <NodeHeader
        type="transform"
        label="TRANSFORM+"
        icon="T"
        onDelete={handleDelete}
        disabled={data.disabled}
        onToggleDisabled={(val) => handleChange('disabled', val)}
      />
      <div className="cf-node-body">
        <div className="cf-node-preview" style={{ aspectRatio: '9 / 16', maxHeight: '180px' }}>
          {videoReady && isConnected && layerObject ? (
            <canvas ref={canvasRef} width={90} height={160} style={{ width: '100%', height: '100%', display: 'block' }} />
          ) : (
            <div className="empty-preview"><span>No Input</span></div>
          )}
        </div>
        <div className="cf-slider-group">
          <AdvancedSlider label="Scale X" value={scaleX} min={10} max={400} step={1} defaultValue={100} onChange={handleScaleX} suffix="%" />
          <AdvancedSlider label="Scale Y" value={scaleY} min={10} max={400} step={1} defaultValue={100} onChange={v => handleChange('scaleY', v)} suffix="%" disabled={lockAspect} />
          <AdvancedSlider label="Rotation" value={rotation} min={-180} max={180} step={1} defaultValue={0} onChange={v => handleChange('rotation', v)} suffix=" deg" />
          <AdvancedSlider label="Pos X" value={posX} min={0} max={100} step={0.5} defaultValue={50} onChange={v => handleChange('posX', v)} suffix="%" />
          <AdvancedSlider label="Pos Y" value={posY} min={0} max={100} step={0.5} defaultValue={50} onChange={v => handleChange('posY', v)} suffix="%" />
        </div>
        <label className="cf-checkbox-row">
          <input type="checkbox" className="cf-checkbox nodrag" checked={lockAspect}
            onChange={e => handleChange('lockAspect', e.target.checked)} />
          Lock aspect ratio
        </label>
      </div>
      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Transformed video output" />
    </div>
  );
}
