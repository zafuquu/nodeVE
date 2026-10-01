import React, { useCallback, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useVideoState } from '../context/VideoProvider';
import { useNodeData } from '../hooks/useNodeData';
import NodeHeader from '../components/NodeHeader';
import AdvancedSlider from '../components/AdvancedSlider';
import { formatSeconds } from '../utils/helpers';

export default function SourceNode({ id, data, selected }) {
  const { videoReady, subscribe, activeClip } = useVideoState();
  const canvasRef = useRef(null);
  const { handleChange, handleDelete } = useNodeData(id, data);

  const { scaleX = 100, scaleY = 100, posX = 50, posY = 50, lockAspect = true } = data;

  // Sync node data with the active timeline clip passively
  useEffect(() => {
    if (activeClip) {
      if (
        data.filepath !== activeClip.filepath ||
        data.filename !== activeClip.filename ||
        data.aspect !== activeClip.aspect
      ) {
        data.updateNodeData?.(id, {
          filepath: activeClip.filepath,
          filename: activeClip.filename,
          width: activeClip.width,
          height: activeClip.height,
          duration: activeClip.duration,
          fps: activeClip.fps,
          aspect: activeClip.aspect || '16:9',
        });
      }
    } else {
      if (data.filepath) {
        data.updateNodeData?.(id, {
          filepath: null,
          filename: null,
          width: 0,
          height: 0,
          duration: 0,
          fps: 0,
          aspect: '16:9',
        });
      }
    }
  }, [activeClip, id, data.filepath, data.filename, data.aspect, data.updateNodeData]);

  // Live thumbnail from shared video
  useEffect(() => {
    if (!videoReady || !canvasRef.current) return;
    const unsub = subscribe((vid) => {
      if (!vid || !canvasRef.current || vid.readyState < 2) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const videoWidth = vid.videoWidth || 1920;
      const videoHeight = vid.videoHeight || 1080;
      const nodeWidth = canvas.width;
      const nodeHeight = canvas.height;

      // Calculate uniform scale
      const scale = Math.min(nodeWidth / videoWidth, nodeHeight / videoHeight);
      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const drawX = (nodeWidth - drawWidth) / 2;
      const drawY = (nodeHeight - drawHeight) / 2;

      // Clear canvas with deep black
      ctx.fillStyle = '#090909';
      ctx.fillRect(0, 0, nodeWidth, nodeHeight);

      // Draw video frame centered
      ctx.drawImage(vid, 0, 0, videoWidth, videoHeight, drawX, drawY, drawWidth, drawHeight);
    });
    return unsub;
  }, [videoReady, subscribe, data.filepath]);

  const handleScaleX = (v) => {
    handleChange('scaleX', v);
    if (lockAspect) handleChange('scaleY', v);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const localFile = files[0];
    if (localFile && localFile.path) {
      if (data.onDropFileOnSource) {
        await data.onDropFileOnSource(localFile.path);
      }
    }
  };

  return (
    <div 
      className={`cf-node ${selected ? 'selected' : ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <NodeHeader
        type="source"
        label="SOURCE"
        onDelete={handleDelete}
      />

      <div className="cf-node-body">
        <div className="cf-node-preview">
          <canvas
            ref={canvasRef}
            width={252}
            height={142}
            style={{
              width: '100%',
              height: '100%',
              display: (data.filepath && videoReady) ? 'block' : 'none'
            }}
          />
          {!(data.filepath && videoReady) && (
            <div className="empty-preview">
              <span>{data.filepath ? 'Loading...' : 'No file loaded'}</span>
            </div>
          )}
        </div>

        {data.filename ? (
          <>
            <div className="cf-file-info">
              <span className="filename">{data.filename}</span>
              <span className="file-meta">{data.width}×{data.height}</span>
            </div>
            <div className="cf-info-row">
              <span className="info-label">Duration</span>
              <span className="info-value precision-slider-val">{formatSeconds(data.duration)}</span>
            </div>
            <div className="cf-info-row">
              <span className="info-label">Aspect</span>
              <select className="cf-select nodrag" value={data.aspect || '16:9'}
                onChange={e => handleChange('aspect', e.target.value)}
                style={{ width: '70px', fontSize: '11px' }}
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="4:3">4:3</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
            <div className="cf-info-row">
              <span className="info-label">FPS</span>
              <span className="info-value precision-slider-val">{data.fps || 60}</span>
            </div>

            <div className="cf-divider" style={{ margin: '8px 0', borderBottom: '1px solid #222' }} />

            <div className="cf-slider-group nodrag">
              <AdvancedSlider label="Scale X" value={scaleX} min={10} max={400} step={1} defaultValue={100} onChange={handleScaleX} suffix="%" />
              <AdvancedSlider label="Scale Y" value={scaleY} min={10} max={400} step={1} defaultValue={100} onChange={v => handleChange('scaleY', v)} suffix="%" disabled={lockAspect} />
              <AdvancedSlider label="Pos X" value={posX} min={0} max={100} step={0.5} defaultValue={50} onChange={v => handleChange('posX', v)} suffix="%" />
              <AdvancedSlider label="Pos Y" value={posY} min={0} max={100} step={0.5} defaultValue={50} onChange={v => handleChange('posY', v)} suffix="%" />
            </div>
            <label className="cf-checkbox-row nodrag">
              <input type="checkbox" className="cf-checkbox" checked={lockAspect}
                onChange={e => handleChange('lockAspect', e.target.checked)} />
              Lock aspect ratio
            </label>

            {data.codec && !['h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1', 'unknown'].includes(data.codec) && (
              <div style={{ padding: '4px 8px', background: 'rgba(243,156,18,0.12)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: '4px', fontSize: '9px', color: '#f39c12', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                Codec "{data.codec}" may not preview in Chromium. Export will still work via FFmpeg.
              </div>
            )}
          </>
        ) : (
          <div className="empty-preview" style={{ padding: '8px', color: '#666', fontSize: '11px', textAlign: 'center' }}>
            No active timeline clip / Drag file here
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="video-out" style={{ top: '50%' }} title="Video output" />
    </div>
  );
}
