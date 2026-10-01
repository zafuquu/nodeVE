import React, { useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useVideoState } from '../context/VideoProvider';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';
import AdvancedSlider from '../components/AdvancedSlider';

export default function CropNode({ id, data, selected }) {
  const { videoRef, videoReady, subscribe } = useVideoState();

  const canvasRef = useRef(null);
  const { handleChange, handleDelete } = useNodeData(id, data);

  const { top = 0, bottom = 0, left = 0, right = 0 } = data;
  const isConnected = data._isConnected;

  useEffect(() => {
    if (!videoReady || !canvasRef.current || !isConnected) return;
    const unsub = subscribe((vid) => {
      if (!vid || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const cw = canvasRef.current.width;
      const ch = canvasRef.current.height;
      const vw = vid.videoWidth || 1920;
      const vh = vid.videoHeight || 1080;

      if (data.disabled) {
        ctx.drawImage(vid, 0, 0, cw, ch);
        return;
      }

      ctx.globalAlpha = 0.3;
      ctx.drawImage(vid, 0, 0, cw, ch);
      ctx.globalAlpha = 1.0;

      const cx = (left / 100) * cw;
      const cy = (top / 100) * ch;
      const cropW = ((100 - left - right) / 100) * cw;
      const cropH = ((100 - top - bottom) / 100) * ch;
      const sx = (left / 100) * vw;
      const sy = (top / 100) * vh;
      const sw = ((100 - left - right) / 100) * vw;
      const sh = ((100 - top - bottom) / 100) * vh;

      ctx.drawImage(vid, sx, sy, sw, sh, cx, cy, cropW, cropH);
      ctx.strokeStyle = '#c8a03e';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cx, cy, cropW, cropH);
      ctx.setLineDash([]);
    });
    return unsub;
  }, [videoReady, subscribe, top, bottom, left, right, data.disabled, isConnected]);

  return (
    <div className={`cf-node ${selected ? 'selected' : ''} ${data.disabled ? 'disabled-node' : ''}`}>
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '50%' }} title="Video input" />
      <NodeHeader 
        type="crop" 
        label="CROP" 
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
        <div className="cf-slider-group">
          <AdvancedSlider label="Top" value={top} min={0} max={90} step={0.5} defaultValue={0} onChange={v => handleChange('top', v)} suffix="%" />
          <AdvancedSlider label="Bottom" value={bottom} min={0} max={90} step={0.5} defaultValue={0} onChange={v => handleChange('bottom', v)} suffix="%" />
          <AdvancedSlider label="Left" value={left} min={0} max={90} step={0.5} defaultValue={0} onChange={v => handleChange('left', v)} suffix="%" />
          <AdvancedSlider label="Right" value={right} min={0} max={90} step={0.5} defaultValue={0} onChange={v => handleChange('right', v)} suffix="%" />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Cropped video output" />
    </div>
  );
}
