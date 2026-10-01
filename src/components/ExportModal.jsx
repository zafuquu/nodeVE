import React, { useState, useEffect } from 'react';

export default function ExportModal({ isOpen, onClose, onExport, gpuAvailable }) {
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [codec, setCodec] = useState(gpuAvailable ? 'h264_nvenc' : 'libx264');
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState('10M');
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, speed: 0 });

  useEffect(() => {
    setCodec(gpuAvailable ? 'h264_nvenc' : 'libx264');
  }, [gpuAvailable]);

  useEffect(() => {
    if (window.clipForge?.onExportProgress) {
      // Clear any stale listeners before registering
      if (window.clipForge.removeExportProgress) {
        window.clipForge.removeExportProgress();
      }
      window.clipForge.onExportProgress((prog) => {
        setProgress(prog);
      });
    }
    return () => {
      if (window.clipForge?.removeExportProgress) {
        window.clipForge.removeExportProgress();
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleStartRender = async () => {
    setIsRendering(true);
    setProgress({ percent: 0, speed: 0 });
    try {
      await onExport({ targetPlatform, codec, fps, bitrate });
      setProgress({ percent: 100, speed: 0 });
      setTimeout(() => {
        setIsRendering(false);
        onClose();
      }, 1500);
    } catch (err) {
      setIsRendering(false);
      alert(`Render failed: ${err.message || err}`);
    }
  };

  const selectStyle = {
    padding: '10px',
    background: '#141414',
    border: '1px solid #333',
    color: '#e0e0e0',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'JetBrains Mono, monospace',
  };

  const fieldStyle = { display: 'flex', flexDirection: 'column', gap: '6px' };
  const labelStyle = { fontSize: '12px', color: '#8b95a8' };

  const bitrateLabel = (val) => {
    if (val === '100M') return '100 Mbps (Lossless)';
    if (val === '50M') return '50 Mbps';
    if (val === '20M') return '20 Mbps';
    if (val === '15M') return '15 Mbps';
    if (val === '10M') return '10 Mbps';
    return val;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: '#1A1A1A', border: '1px solid #333', borderRadius: '4px',
        padding: '24px', width: '460px', display: 'flex', flexDirection: 'column', gap: '20px',
        color: '#e0e0e0', boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '14px', margin: 0, letterSpacing: '1px', fontFamily: 'JetBrains Mono' }}>
            {isRendering ? 'RENDERING...' : 'EXPORT SETTINGS'}
          </h2>
          {!isRendering && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8b95a8', cursor: 'pointer', fontSize: '18px' }}>x</button>
          )}
        </div>

        {isRendering && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ height: '8px', background: '#0a0a10', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progress.percent || 0}%`,
                background: 'linear-gradient(90deg, #c80000, #ff4444)',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8b95a8', fontFamily: 'JetBrains Mono' }}>
              <span>{progress.percent || 0}%</span>
              <span>{progress.speed ? `${progress.speed}x speed` : 'Starting...'}</span>
            </div>
            <button
              onClick={async () => {
                if (window.clipForge?.cancelExport) {
                  await window.clipForge.cancelExport();
                }
                setIsRendering(false);
                setProgress({ percent: 0, speed: 0 });
              }}
              style={{ padding: '8px 16px', background: '#333', border: '1px solid #555', color: '#e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px', alignSelf: 'center', marginTop: '4px' }}
            >
              Cancel Render
            </button>
          </div>
        )}

        {!isRendering && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Target Platform</label>
              <select value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value)} style={selectStyle}>
                <option value="tiktok">TikTok</option>
                <option value="shorts">YouTube Shorts</option>
                <option value="reels">Instagram Reels</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Video Codec</label>
              <select value={codec} onChange={(e) => setCodec(e.target.value)} style={selectStyle}>
                {gpuAvailable && <option value="h264_nvenc">H.264 (NVIDIA NVENC)</option>}
                <option value="libx264">H.264 (libx264 CPU)</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Frame Rate</label>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))} style={selectStyle}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
                <option value={120}>120 fps</option>
                <option value={144}>144 fps</option>
              </select>
              {fps > 60 && (
                <span style={{ fontSize: '10px', color: '#f39c12', marginTop: '2px' }}>
                  ⚠ {fps}fps may not be supported by all players/platforms
                </span>
              )}
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Target Bitrate</label>
              <select value={bitrate} onChange={(e) => setBitrate(e.target.value)} style={selectStyle}>
                <option value="10M">10 Mbps</option>
                <option value="15M">15 Mbps</option>
                <option value="20M">20 Mbps</option>
                <option value="50M">50 Mbps</option>
                <option value="100M">100 Mbps (Lossless)</option>
              </select>
            </div>

            <div style={{ padding: '10px 12px', background: 'rgba(0,200,150,0.07)', border: '1px solid rgba(0,200,150,0.25)', borderRadius: '4px', fontSize: '10px', color: '#00c896', fontFamily: 'JetBrains Mono, monospace', lineHeight: '1.5' }}>
              ✦ Recommended for TikTok / Reels / Shorts: H.264 · 1080×1920 · 30fps · 8–12 Mbps
            </div>

            <div style={{ padding: '10px', background: '#141414', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', color: '#a0a0a0', fontFamily: 'JetBrains Mono, monospace' }}>
              1080x1920 / {fps} fps / {bitrate} / {targetPlatform.toUpperCase()} / {codec.includes('nvenc') ? 'GPU' : 'CPU'}
            </div>
          </div>
        )}

        {!isRendering && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
            <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2d3e', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              Cancel
            </button>
            <button
              onClick={handleStartRender}
              disabled={isRendering}
              style={{ padding: '10px 20px', background: isRendering ? '#333' : 'var(--color-accent, #c80000)', border: 'none', color: isRendering ? '#666' : '#fff', borderRadius: '4px', cursor: isRendering ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}
            >
              Start Render
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
