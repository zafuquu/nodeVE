import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { asTimelineNumber, getClipEffectiveDurationSec, sanitizeTimelineClip } from '../utils/timelineClips';

/**
 * ═══════════════════════════════════════════════════════════
 *  VideoProvider — DECOUPLED SHADOW AUDIO SEQUENCING ENGINE
 * ═══════════════════════════════════════════════════════════
 *
 *  Provides a high-performance multi-clip timeline synchronization
 *  layer. Supports sequential video clips (CONCAT) and background
 *  music mixing (AUDIO) with custom offsets and volumes.
 */

const VideoStateContext = createContext(null);
const VideoTimeContext = createContext(null);

export function useVideoState() {
  const ctx = useContext(VideoStateContext);
  if (!ctx) throw new Error('useVideoState must be used inside <VideoProvider>');
  return ctx;
}

export function useVideoTime() {
  const ctx = useContext(VideoTimeContext);
  if (!ctx) throw new Error('useVideoTime must be used inside <VideoProvider>');
  return ctx;
}

export function useVideo() {
  const stateCtx = useContext(VideoStateContext);
  const timeCtx = useContext(VideoTimeContext);
  if (!stateCtx || !timeCtx) throw new Error('useVideo must be used inside <VideoProvider>');
  return useMemo(() => ({ ...stateCtx, ...timeCtx }), [stateCtx, timeCtx]);
}

export function VideoProvider({ children, filepath, width, height, clips = [], bgMusic = null, onActiveClipChange, sourceDuration = 0 }) {
  // ── Master Media Element Refs ──────────────────────────────
  const masterVideoRef = useRef(null);
  const masterAudioRef = useRef(null);
  const bgMusicRef = useRef(null);

  const subscribersRef = useRef(new Set());
  const rafRef = useRef(null);
  const lastTimePublishRef = useRef(0);

  // ── Seek-debounce state ───────────────────────────────────
  const isSeekingRef = useRef(false);
  const wasPlayingBeforeSeekRef = useRef(false);

  // ── React state ───────────────────────────────────────────
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isDimmed, setIsDimmed] = useState(false);

  // Parse sequence of clips with trim support (trimIn and trimOut in milliseconds)
  // Only V1 video clips drive the master playback engine
  const resolvedClips = useMemo(() => {
    if (clips && clips.length > 0) {
      const v1clips = clips
        .map((clip, index) => sanitizeTimelineClip(clip, index))
        .filter(c => c.trackType === 'video' && Number(c.trackIndex) === 1)
        .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
      return v1clips.map(c => {
        const effectiveDuration = getClipEffectiveDurationSec(c);
        return {
          ...c,
          effectiveDuration,
          startOffset: asTimelineNumber(c.startOffset, 0),
        };
      });
    }
    if (filepath) {
      const duration = Math.max(0, asTimelineNumber(sourceDuration, 0));
      return [{
        filepath,
        duration,
        width: width || 0,
        height: height || 0,
        trimIn: 0,
        trimOut: duration * 1000,
        effectiveDuration: duration,
        startOffset: 0,
      }];
    }
    return [];
  }, [clips, filepath, width, height, sourceDuration]);

  // Compute duration and clip start/end boundaries based on effective durations
  const totalDuration = useMemo(() => {
    return resolvedClips.reduce((max, c) => {
      const start = Math.max(0, asTimelineNumber(c.startOffset, 0));
      const end = start + Math.max(0, asTimelineNumber(c.effectiveDuration, 0));
      return Math.max(max, end);
    }, 0);
  }, [resolvedClips]);

  const clipsWithRange = useMemo(() => {
    return resolvedClips.map((c) => {
      const start = Math.max(0, asTimelineNumber(c.startOffset, 0));
      const end = start + Math.max(0, asTimelineNumber(c.effectiveDuration, 0));
      return { ...c, start, end };
    });
  }, [resolvedClips]);

  // Active clip math
  const activeInfo = useMemo(() => {
    if (clipsWithRange.length === 0) return { index: 0, clip: null, localTime: 0 };
    let index = clipsWithRange.findIndex(c => currentTime >= c.start && currentTime < c.end);
    if (index === -1) {
      const nextIndex = clipsWithRange.findIndex(c => currentTime < c.start);
      index = nextIndex === -1 ? clipsWithRange.length - 1 : nextIndex;
    }
    const clip = clipsWithRange[index];
    if (!clip) return { index: 0, clip: null, localTime: 0 };
    
    // Convert global time offset within the clip block to local video frame time
    const localOffset = Math.max(0, Math.min(clip.effectiveDuration, currentTime - clip.start));
    const nativeStart = clip.trimIn / 1000;
    const localTime = nativeStart + localOffset;
    return { index, clip, localTime };
  }, [clipsWithRange, currentTime, totalDuration]);

  // Store refs to avoid stale closures in RAF loop
  const activeInfoRef = useRef(activeInfo);
  const isPlayingRef = useRef(isPlaying);
  const totalDurationRef = useRef(totalDuration);

  useEffect(() => {
    activeInfoRef.current = activeInfo;
    if (onActiveClipChange && activeInfo.index !== undefined) {
      onActiveClipChange(activeInfo.clip?.sourceIndex ?? activeInfo.index);
    }
  }, [activeInfo, onActiveClipChange]);

  // Sync background music volume and play state
  useEffect(() => {
    const music = bgMusicRef.current;
    if (!music) return;
    if (bgMusic && bgMusic.filepath) {
      const baseVol = Math.max(0, Math.min(1, asTimelineNumber(bgMusic.volume, 50) / 100));
      music.volume = isDimmed ? baseVol * 0.2 : baseVol;
    }
  }, [bgMusic, isDimmed]);

  // Sync master volume and DIM state
  useEffect(() => {
    const video = masterVideoRef.current;
    const vol = isDimmed ? 0.2 : 1.0;
    if (video) {
      video.muted = false;
      video.volume = vol;
    }
  }, [isDimmed]);

  // Set initial readiness
  useEffect(() => {
    if (resolvedClips.length > 0) {
      setVideoReady(true);
    } else {
      setVideoReady(false);
    }
  }, [resolvedClips]);

  // ── Sync Play/Pause status to DOM ──────────────────────────
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const video = masterVideoRef.current;
    const music = bgMusicRef.current;

    if (isPlaying) {
      if (video && video.paused && video.readyState >= 2) video.play().catch(() => {});
      if (music && music.paused && music.readyState >= 2) music.play().catch(() => {});
    } else {
      if (video) video.pause();
      if (music) music.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    totalDurationRef.current = totalDuration;
    setMediaDuration(totalDuration);
  }, [totalDuration]);

  // ── Load & Bind Master Elements ────────────────────────────
  const activeFilepath = activeInfo.clip?.filepath;
  useEffect(() => {
    const video = masterVideoRef.current;
    if (!video) return;

    if (activeFilepath) {
      const targetSrc = `media:///${activeFilepath.replace(/\\/g, '/')}`;
      
      const handleLoaded = () => {
        const cInfo = activeInfoRef.current;
        if (cInfo && cInfo.clip && cInfo.clip.filepath === activeFilepath) {
          video.currentTime = cInfo.localTime;
          if (isPlayingRef.current) {
            video.play().catch(() => {});
          }
        }
      };

      if (video.getAttribute('src') !== targetSrc) {
        video.src = targetSrc;
        video.addEventListener('loadeddata', handleLoaded, { once: true });
        video.load();
      } else {
        if (!isPlaying) {
          const drift = Math.abs(video.currentTime - activeInfo.localTime);
          if (drift > 0.1) {
            video.currentTime = activeInfo.localTime;
          }
        }
      }
    }
  }, [activeFilepath, activeInfo.localTime, isPlaying]);

  // ── RAF Loop ──────────────────────────────────────────────
  const startRAFLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      const activeIdx = activeInfoRef.current.index;
      const activeClip = activeInfoRef.current.clip;
      const video = masterVideoRef.current;
      const music = bgMusicRef.current;

      let globalT = currentTimeRef.current;

      if (video && !isSeekingRef.current) {
        const currentLocalTime = video.currentTime;
        const nativeStart = activeClip ? activeClip.trimIn / 1000 : 0;
        const localOffset = Math.max(0, currentLocalTime - nativeStart);
        globalT = (activeClip?.start || 0) + localOffset;

        const isPlayingNow = isPlayingRef.current;
        if (isPlayingNow) {
          // Keep canvas/subscribers on RAF, but reduce React state churn during playback.
          const throttleLimit = 80;
          const now = performance.now();
          if (now - lastTimePublishRef.current >= throttleLimit) {
            lastTimePublishRef.current = now;
            setCurrentTime(Math.min(totalDurationRef.current, globalT));
          }

          // Transition check based on trimOut limit
          const nativeOut = activeClip ? activeClip.trimOut / 1000 : (activeClip?.duration || 0);
          if (currentLocalTime >= nativeOut - 0.02) {
            const nextIdx = activeIdx + 1;
            if (nextIdx < clipsWithRange.length) {
              // Transition to next clip
              const nextClip = clipsWithRange[nextIdx];
              const nextStart = nextClip ? nextClip.trimIn / 1000 : 0;
              const nextSrc = `media:///${nextClip.filepath.replace(/\\/g, '/')}`;

              if (video.getAttribute('src') !== nextSrc) {
                video.src = nextSrc;
                video.load();
              }
              video.currentTime = nextStart;
              video.play().catch(() => {});
              
              setCurrentTime(nextClip.start);
            } else {
              // Timeline finished
              setIsPlaying(false);
              setCurrentTime(0);
              const firstClip = clipsWithRange[0];
              if (firstClip) {
                const firstSrc = `media:///${firstClip.filepath.replace(/\\/g, '/')}`;
                if (video.getAttribute('src') !== firstSrc) {
                  video.src = firstSrc;
                  video.load();
                }
                video.currentTime = firstClip.trimIn / 1000;
              }
              if (music) {
                music.pause();
                music.currentTime = 0;
              }
            }
          }

          // Background Music Sync
          if (music && bgMusic && bgMusic.filepath) {
            const offset = Math.max(0, asTimelineNumber(bgMusic.offset, 0));
            if (globalT >= offset) {
              const musicTime = globalT - offset;
              if (music.paused) music.play().catch(() => {});
              const musicDrift = Math.abs(music.currentTime - musicTime);
              if (musicDrift > 0.15) {
                music.currentTime = musicTime;
              }
            } else {
              if (!music.paused) music.pause();
            }
          }
        }
      }

      // Notify all canvas draw subscribers at 60fps
      if (video) {
        subscribersRef.current.forEach(cb => {
          try { cb(video, globalT); } catch (e) { /* noop */ }
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [clipsWithRange, bgMusic]);

  // Start RAF loop on mount
  useEffect(() => {
    startRAFLoop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [startRAFLoop]);

  // ── Subscriber API ────────────────────────────────────────
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback);
    return () => subscribersRef.current.delete(callback);
  }, []);

  // ── Play/Pause ────────────────────────────────────────────
  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying(p => !p);
  }, []);

  // ── Seek ──────────────────────────────────────────────────
  const seek = useCallback((time) => {
    const targetTime = Math.max(0, Math.min(totalDuration, Number(time) || 0));
    currentTimeRef.current = targetTime;
    setCurrentTime(targetTime);

    let index = clipsWithRange.findIndex(c => targetTime >= c.start && targetTime < c.end);
    if (index === -1) {
      const nextIndex = clipsWithRange.findIndex(c => targetTime < c.start);
      index = nextIndex === -1 ? clipsWithRange.length - 1 : nextIndex;
    }
    const clip = clipsWithRange[index];
    if (!clip) return;

    const localOffset = Math.max(0, targetTime - clip.start);
    const localSeekTimeSec = (clip.trimIn / 1000) + localOffset;

    const video = masterVideoRef.current;
    const targetSrc = `media:///${clip.filepath.replace(/\\/g, '/')}`;

    if (video) {
      if (video.getAttribute('src') !== targetSrc) {
        video.src = targetSrc;
        video.load();
        video.addEventListener('loadeddata', () => {
          video.currentTime = localSeekTimeSec;
        }, { once: true });
      } else {
        video.currentTime = localSeekTimeSec;
      }
    }

    if (bgMusicRef.current && bgMusic) {
      const offset = Math.max(0, asTimelineNumber(bgMusic.offset, 0));
      if (targetTime >= offset) {
        bgMusicRef.current.currentTime = targetTime - offset;
      } else {
        bgMusicRef.current.currentTime = 0;
      }
    }
  }, [clipsWithRange, totalDuration, bgMusic]);

  // ── Begin Seek ────────────────────────────────────────────
  const beginSeek = useCallback(() => {
    wasPlayingBeforeSeekRef.current = isPlayingRef.current;
    isSeekingRef.current = true;
    setIsPlaying(false);

    const music = bgMusicRef.current;
    if (music) music.pause();
  }, []);

  // ── End Seek ──────────────────────────────────────────────
  const endSeek = useCallback(() => {
    isSeekingRef.current = false;
    
    const video = masterVideoRef.current;
    const music = bgMusicRef.current;

    const currentTime = currentTimeRef.current;

    if (music && bgMusic && bgMusic.filepath) {
      const offset = Math.max(0, asTimelineNumber(bgMusic.offset, 0));
      if (currentTime >= offset) {
        music.currentTime = currentTime - offset;
      } else {
        music.currentTime = 0;
      }
    }

    if (wasPlayingBeforeSeekRef.current) {
      setIsPlaying(true);
    }
    wasPlayingBeforeSeekRef.current = false;
  }, [bgMusic]);

  // ── Keyboard shortcut listeners ───────────────────────────
  useEffect(() => {
    const onToggle = () => togglePlay();
    const onStepBack = () => {
      seek(Math.max(0, currentTime - (1 / 60)));
    };
    const onStepForward = () => {
      seek(currentTime + (1 / 60));
    };
    document.addEventListener('clipforge:togglePlay', onToggle);
    document.addEventListener('clipforge:stepBack', onStepBack);
    document.addEventListener('clipforge:stepForward', onStepForward);
    return () => {
      document.removeEventListener('clipforge:togglePlay', onToggle);
      document.removeEventListener('clipforge:stepBack', onStepBack);
      document.removeEventListener('clipforge:stepForward', onStepForward);
    };
  }, [togglePlay, seek, currentTime]);

  // ── Context Values ────────────────────────────────────────
  const stateValue = useMemo(() => ({
    videoRef: masterVideoRef,
    audioRef: masterAudioRef,
    videoReady,
    videoSrc: resolvedClips[activeInfo.index]?.filepath ? `media:///${resolvedClips[activeInfo.index].filepath.replace(/\\/g, '/')}` : null,
    srcW: resolvedClips[activeInfo.index]?.width || 0,
    srcH: resolvedClips[activeInfo.index]?.height || 0,
    activeClip: resolvedClips[activeInfo.index] || null,
    play,
    pause,
    togglePlay,
    seek,
    beginSeek,
    endSeek,
    subscribe,
    isDimmed,
    setIsDimmed,
  }), [videoReady, activeInfo.index, resolvedClips, play, pause, togglePlay, seek, beginSeek, endSeek, subscribe, isDimmed]);

  const timeValue = useMemo(() => ({
    isPlaying,
    currentTime,
    duration: totalDuration,
  }), [isPlaying, currentTime, totalDuration]);

  return (
    <VideoStateContext.Provider value={stateValue}>
      <VideoTimeContext.Provider value={timeValue}>
        {children}
        <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0, width: '1px', height: '1px', pointerEvents: 'none', overflow: 'hidden' }}>
          <video
            ref={masterVideoRef}
            playsInline
            crossOrigin="anonymous"
            preload="auto"
          />
          {bgMusic && bgMusic.filepath && (
            <audio
              key={`bg-music-${bgMusic.filepath}`}
              ref={bgMusicRef}
              src={`media:///${bgMusic.filepath.replace(/\\/g, '/')}`}
              crossOrigin="anonymous"
              preload="auto"
            />
          )}
        </div>
      </VideoTimeContext.Provider>
    </VideoStateContext.Provider>
  );
}
