import { useState, useCallback, useMemo } from 'react';
import { sanitizeTimelineClip, getClipEffectiveDurationSec } from '../utils/timelineClips';

const DEFAULT_ASSET = {
  id: 'default-1',
  filename: 'sample_video.mp4',
  filepath: 'C:/Users/erna/Downloads/YTDown_YouTube_Random-5_Media_zg6yRnohdUs_001_1080p.mp4',
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 60,
  aspect: '16:9'
};

/**
 * Custom hook for managing media pool assets and importing files.
 * Integrates with Electron's file dialog and ffprobe for metadata.
 */
export function useMediaPool() {
  const [mediaPool, setMediaPool] = useState([DEFAULT_ASSET]);

  const importFilePaths = useCallback(async (filepaths) => {
    if (!filepaths || filepaths.length === 0) return;

    const newAssets = [];
    for (const filepath of filepaths) {
      const filename = filepath.split(/[\\/]/).pop();
      let duration = 10;
      let width = 1920;
      let height = 1080;
      let fps = 60;
      let aspect = '16:9';

      if (window.clipForge?.probeVideo) {
        try {
          const meta = await window.clipForge.probeVideo(filepath);
          duration = meta.duration || 10;
          width = meta.width || 1920;
          height = meta.height || 1080;
          fps = meta.fps || 60;
          aspect = width > height ? '16:9' : '9:16';
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
      // Dummy asset for browser preview mode
      const dummyId = Math.random().toString(36).substring(7);
      const filename = `clip_${dummyId}.mp4`;
      const filepath = `C:/Users/erna/Downloads/YTDown_YouTube_Random-5_Media_zg6yRnohdUs_001_1080p.mp4`;
      setMediaPool(prev => [...prev, {
        id: dummyId,
        filename,
        filepath,
        duration: 30,
        width: 1920,
        height: 1080,
        fps: 60,
        aspect: '16:9'
      }]);
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