import React, { useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useVideoState } from '../context/VideoProvider';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';
import AdvancedSlider from '../components/AdvancedSlider';

const SHAPES = ['rectangle', 'ellipse', 'custom'];

/**
 * MaskNode — Live video preview with mask bounding boxes overlay
 */
export default function MaskNode({ id, data, selected }) {
  const { videoRef, videoReady, subscribe } = useVideoState();

  const canvasRef = useRef(null);
  const { handleChange, handleDelete } = useNodeData(id, data);

  const { shape = 'rectangle', feather = 5, invert = false, rects = [] } = data;
  const subtractMode = data.subtractMode ?? invert;
  const isConnected = data._isConnected;

  // Draw video + mask regions
  useEffect(() => {
    if (!videoReady || !canvasRef.current || !isConnected) return;
    const unsub = subscribe((vid) => {
      if (!vid || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const cw = canvasRef.current.width;
      const ch = canvasRef.current.height;

      // Draw video frame
      ctx.globalAlpha = subtractMode ? 1.0 : 0.6;
      ctx.drawImage(vid, 0, 0, cw, ch);
      ctx.globalAlpha = 1.0;

      // Draw mask bounding boxes
      if (rects.length > 0) {
        const scaleX = cw / 640;
        const scaleY = ch / 360;
        rects.forEach(r => {
          const rx = r.x * scaleX;
          const ry = r.y * scaleY;
          const rw = r.width * scaleX;
          const rh = r.height * scaleY;

          if (subtractMode) {
            ctx.fillStyle = 'rgba(231, 76, 60, 0.4)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#e74c3c';
          } else {
            ctx.fillStyle = 'rgba(155, 89, 182, 0.3)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#9b59b6';
          }
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
        });
      } else {
        const pad = 15;
        ctx.strokeStyle = subtractMode ? '#e74c3c' : '#9b59b6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        if (shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(cw / 2, ch / 2, (cw - pad * 2) / 2, (ch - pad * 2) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(pad, pad, cw - pad * 2, ch - pad * 2);
        }
        ctx.setLineDash([]);
      }

      // Label
      if (subtractMode) {
        ctx.fillStyle = 'rgba(231, 76, 60, 0.8)';
        ctx.fillRect(0, 0, cw, 11);
        ctx.fillStyle = '#fff';
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillText('SUBTRACT', 3, 8);
      }
    });
    return unsub;
  }, [videoReady, subscribe, shape, subtractMode, rects, isConnected, data.disabled]);

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '50%' }} title="Video input" />

      <NodeHeader
        type="mask"
        label="MASK"
        onDelete={handleDelete}
        disabled={data.disabled}
        onToggleDisabled={(val) => handleChange('disabled', val)}
      />

      <div className="cf-node-body">
        <div className="cf-node-preview">
          {videoReady && isConnected ? (
            <canvas ref={canvasRef} width={252} height={142} style={{ width: '100%', height: '100%', display: 'block' }} />
          ) : (
            <div className="empty-preview"><span>No Input</span></div>
          )}
        </div>

        <select className="cf-select nodrag" value={shape} onChange={e => handleChange('shape', e.target.value)}>
          {SHAPES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>

        <div className="cf-slider-group">
          <AdvancedSlider label="Feather" value={feather} min={0} max={30} step={1} defaultValue={5} onChange={v => handleChange('feather', v)} suffix="px" />
        </div>

        <label className="cf-checkbox-row">
          <input type="checkbox" className="cf-checkbox nodrag" checked={subtractMode}
            onChange={e => data.updateNodeData?.(id, { subtractMode: e.target.checked, invert: e.target.checked })} />
          Subtract mode
        </label>

        <button className="cf-node-btn nodrag"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('open-mask-editor', { detail: { nodeId: id, maskData: data } }));
          }}
          style={{ marginTop: '10px', background: 'rgba(155,89,182,0.2)', borderColor: '#9b59b6', color: '#fff' }}
        >
          Edit Vector Mask
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Masked video output" />
    </div>
  );
}
