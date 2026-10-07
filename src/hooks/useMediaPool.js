import { useState, useCallback, useMemo } from 'react';
import { sanitizeTimelineClip, getClipEffectiveDurationSec } from '../utils/timelineClips';

/**
 * Custom hook for managing media pool assets and importing files.
 * Integrates with Electron's file dialog and ffprobe for metadata.
 */
export function useMediaPool() {
  const [mediaPool, setMediaPool] = useState([]);

  const importFilePaths = useCallback(async (filepaths) => {
    if (!filepaths || filepaths.length === 0) return;

    const newAssets = [];
    for (const filepath of filepaths) {
      const filename = filepath.split(/[\\/]/).pop();
      let duration = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      let aspect = 'unknown';

      if (window.clipForge?.probeVideo) {
        try {
          const meta = await window.clipForge.probeVideo(filepath);
          duration = Number(meta.duration) || 0;
          width = Number(meta.width) || 0;
          height = Number(meta.height) || 0;
          fps = Number(meta.fps) || 0;
          aspect = width > 0 && height > 0 ? (width > height ? '16:9' : '9:16') : 'unknown';
        } catch (e) {
          console.warn('[importFilePaths] Probe failed:', e);
        }
      }

      newAssets.push({
        id: Math.random().toString(36).substring(7),
        filename,
        filepath,
        duration,
        width,
        height,
        fps,
        aspect,
      });
    }

    if (newAssets.length > 0) {
      setMediaPool(prev => [...prev, ...newAssets]);
    }
  }, []);

  const handleImportMedia = useCallback(async () => {
    if (!window.clipForge) {
      console.warn('[handleImportMedia] Electron media bridge unavailable; no media was imported.');
      return;
    }

    let filepaths = [];
    if (window.clipForge.openFiles) {
      filepaths = await window.clipForge.openFiles() || [];
    } else if (window.clipForge.openFile) {
      const pathVal = await window.clipForge.openFile();
      if (pathVal) filepaths = [pathVal];
    }

    if (filepaths && filepaths.length > 0) {
      await importFilePaths(filepaths);
    }
  }, [importFilePaths]);

  const handleAddFromMediaPool = useCallback((asset) => {
    const newClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      filename: asset.filename,
      filepath: asset.filepath,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      aspect: asset.aspect,
      trimIn: 0,
      trimOut: asset.duration * 1000,
      trackType: asset.trackType || (asset.isAudio || asset.aspect === 'audio' ? 'audio' : 'video'),
      trackIndex: asset.trackIndex,
      startOffset: asset.startOffset,
    };
    return newClip;
  }, []);

  // ── Thumbnail generation (video frame extraction) ──────
  const [thumbnailsCache, setThumbnailsCache] = useState({});

  const generateThumbnails = useCallback((filepath, duration) => {
    if (!filepath || thumbnailsCache[filepath]) return;

    const tempVid = document.createElement('video');
    tempVid.src = `media:///${filepath.replace(/\\/g, '/')}`;
    tempVid.muted = true;
    tempVid.crossOrigin = 'anonymous';
    tempVid.preload = 'auto';

    tempVid.addEventListener('loadedmetadata', async () => {
      const frames = [];
      const step = duration <= 10 ? 1 : (duration <= 30 ? 3 : (duration <= 60 ? 5 : 10));
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 68;
      const ctx = canvas.getContext('2d');

      for (let t = 0; t < duration; t += step) {
        tempVid.currentTime = t;
        await new Promise((resolve) => {
          const onSeeked = () => {
            tempVid.removeEventListener('seeked', onSeeked);
            resolve();
          };
          tempVid.addEventListener('seeked', onSeeked);
        });

        try {
          ctx.drawImage(tempVid, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
          frames.push({ time: t, dataUrl });
        } catch (e) {
          console.error('[generateThumbnails] frame draw error:', e);
        }
      }

      setThumbnailsCache(prev => ({
        ...prev,
        [filepath]: frames
      }));

      tempVid.src = '';
    });
  }, [thumbnailsCache]);

  const setMediaPoolAndGenerateThumbnails = useCallback((newMediaPool, updater) => {
    setMediaPool(typeof newMediaPool === 'function' ? newMediaPool : newMediaPool);
    const assets = Array.isArray(newMediaPool) ? newMediaPool : [newMediaPool];
    assets.forEach(asset => {
      if (asset.filepath && !thumbnailsCache[asset.filepath]) {
        generateThumbnails(asset.filepath, asset.duration);
      }
    });
  }, [thumbnailsCache, generateThumbnails]);

  return {
    mediaPool,
    setMediaPool,
    thumbnailsCache,
    setThumbnailsCache,
    generateThumbnails,
    importFilePaths,
    handleImportMedia,
    handleAddFromMediaPool,
    setMediaPoolAndGenerateThumbnails,
  };
}