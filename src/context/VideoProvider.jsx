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
  const timelineAudioRefs = useRef(new Map());
  const timelineVideoRefs = useRef(new Map());

  const subscribersRef = useRef(new Set());
  const rafRef = useRef(null);
  const lastTimePublishRef = useRef(0);
  const lastRafTimestampRef = useRef(0);

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

  // Standalone timeline audio clips (voiceover / A1-A3) share the same
  // master timeline clock as V1 video playback and may overlap each other.
  const timelineAudioClips = useMemo(() => {
    return (clips || [])
      .map((clip, index) => sanitizeTimelineClip(clip, index))
      .filter(c => c.trackType === 'audio' && c.filepath && !/^blob:/i.test(String(c.filepath)))
      .map(c => ({
        ...c,
        start: Math.max(0, asTimelineNumber(c.startOffset, 0)),
        effectiveDuration: getClipEffectiveDurationSec(c),
      }));
  }, [clips]);

  // All video tracks share the master timeline clock. V1 drives the
  // master element; V2/V3 are synchronized shadow video elements.
  const timelineVideoClips = useMemo(() => {
    return (clips || [])
      .map((clip, index) => sanitizeTimelineClip(clip, index))
      .filter(c =>
        c.trackType === 'video' &&
        [1, 2, 3].includes(Number(c.trackIndex)) &&
        c.filepath
      )
      .map(c => ({
        ...c,
        trackIndex: Number(c.trackIndex),
        start: Math.max(0, asTimelineNumber(c.startOffset, 0)),
        effectiveDuration: getClipEffectiveDurationSec(c),
      }));
  }, [clips]);

  // Compute duration from every video track so seeking/playback cannot stop
  // before an overlay that extends beyond the V1 base program.
  const totalDuration = useMemo(() => {
    return timelineVideoClips.reduce((max, c) => {
      const end = c.start + Math.max(0, asTimelineNumber(c.effectiveDuration, 0));
      return Math.max(max, end);
    }, 0);
  }, [timelineVideoClips]);

  const clipsWithRange = useMemo(() => {
    return resolvedClips.map((c) => {
      const start = Math.max(0, asTimelineNumber(c.startOffset, 0));
      const end = start + Math.max(0, asTimelineNumber(c.effectiveDuration, 0));
      return { ...c, start, end };
    });
  }, [resolvedClips]);

  // Active clip math
  const activeInfo = useMemo(() => {
    if (clipsWithRange.length === 0) return { index: 0, clip: null, localTime: 0, inGap: false };

    const activeIndex = clipsWithRange.findIndex(c => currentTime >= c.start && currentTime < c.end);
    if (activeIndex !== -1) {
      const clip = clipsWithRange[activeIndex];
      const localOffset = Math.max(0, Math.min(clip.effectiveDuration, currentTime - clip.start));
      const nativeStart = clip.trimIn / 1000;
      return { index: activeIndex, clip, localTime: nativeStart + localOffset, inGap: false };
    }

    const nextIndex = clipsWithRange.findIndex(c => currentTime < c.start);
    if (nextIndex !== -1) {
      return { index: nextIndex, clip: null, localTime: 0, inGap: true };
    }

    const lastIndex = clipsWithRange.length - 1;
    return { index: lastIndex, clip: null, localTime: 0, inGap: false };
  }, [clipsWithRange, currentTime]);

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
    setVideoReady(resolvedClips.length > 0 && !activeInfo.inGap);
  }, [resolvedClips, activeInfo.inGap]);

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

    if (!activeFilepath) {
      video.pause();
      if (video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      return;
    }

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

  const syncTimelineVideoTracks = useCallback((timelineTime, shouldPlay) => {
    [2, 3].forEach((trackIndex) => {
      const video = timelineVideoRefs.current.get(trackIndex);
      if (!video) return;

      const candidates = timelineVideoClips
        .filter(c => c.trackIndex === trackIndex)
        .filter(c => timelineTime >= c.start && timelineTime < c.start + c.effectiveDuration)
        .sort((a, b) => b.start - a.start);
      const clip = candidates[0];

      if (!clip) {
        if (!video.paused) video.pause();
        return;
      }

      const targetSrc = `media:///${String(clip.filepath).replace(/\\/g, '/')}`;
      const localTime = Math.max(0, clip.trimIn / 1000 + (timelineTime - clip.start));

      if (video.getAttribute('src') !== targetSrc) {
        video.src = targetSrc;
        video.load();
        video.addEventListener('loadeddata', () => {
          try { video.currentTime = localTime; } catch {}
          if (shouldPlay) video.play().catch(() => {});
        }, { once: true });
      } else {
        if (!Number.isFinite(video.currentTime) || Math.abs(video.currentTime - localTime) > 0.12) {
          try { video.currentTime = localTime; } catch {}
        }
        if (shouldPlay) {
          if (video.paused && video.readyState >= 2) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      }
    });
  }, [timelineVideoClips]);

  const syncTimelineAudio = useCallback((timelineTime, shouldPlay) => {
    const activeIds = new Set();
    timelineAudioClips.forEach((clip) => {
      const audio = timelineAudioRefs.current.get(clip.id);
      if (!audio) return;

      const start = clip.start;
      const end = start + Math.max(0, clip.effectiveDuration);
      const inRange = timelineTime >= start && timelineTime < end;
      const volume = Math.max(0, Math.min(1, asTimelineNumber(clip.volume, 100) / 100));
      audio.volume = volume;

      if (inRange) {
        activeIds.add(clip.id);
        const targetTime = Math.max(0, clip.trimIn / 1000 + (timelineTime - start));
        if (!Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime - targetTime) > 0.15) {
          try { audio.currentTime = targetTime; } catch {}
        }
        if (shouldPlay && audio.paused) audio.play().catch(() => {});
        if (!shouldPlay && !audio.paused) audio.pause();
      } else {
        if (!audio.paused) audio.pause();
        if (timelineTime < start && audio.currentTime !== 0) {
          try { audio.currentTime = 0; } catch {}
        }
      }
    });

    // Stop any stale audio element whose clip was removed while playing.
    timelineAudioRefs.current.forEach((audio, id) => {
      if (!timelineAudioClips.some(c => c.id === id) && !audio.paused) audio.pause();
    });

    return activeIds;
  }, [timelineAudioClips]);

  // ── RAF Loop ──────────────────────────────────────────────
  const startRAFLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (timestamp = performance.now()) => {
      const previousTimestamp = lastRafTimestampRef.current || timestamp;
      const deltaSec = Math.max(0, Math.min(0.1, (timestamp - previousTimestamp) / 1000));
      lastRafTimestampRef.current = timestamp;

      const activeIdx = activeInfoRef.current.index;
      const activeClip = activeInfoRef.current.clip;
      const video = masterVideoRef.current;
      const music = bgMusicRef.current;

      let globalT = currentTimeRef.current;

      if (activeInfoRef.current.inGap) {
        if (video) video.pause();
        if (isPlayingRef.current && !isSeekingRef.current) {
          globalT = Math.min(totalDurationRef.current, globalT + deltaSec);
          currentTimeRef.current = globalT;
          setCurrentTime(globalT);
        }
      } else if (video && !isSeekingRef.current) {
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

      syncTimelineVideoTracks(globalT, isPlayingRef.current && !isSeekingRef.current);
      syncTimelineAudio(globalT, isPlayingRef.current && !isSeekingRef.current);

      // Notify all canvas draw subscribers at 60fps
      if (video) {
        subscribersRef.current.forEach(cb => {
          try { cb(video, globalT); } catch (e) { /* noop */ }
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [clipsWithRange, bgMusic, syncTimelineAudio, syncTimelineVideoTracks]);

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

    // Seek all overlay tracks against the same global timeline position.
    [2, 3].forEach((trackIndex) => {
      const video = timelineVideoRefs.current.get(trackIndex);
      if (!video) return;
      const clip = timelineVideoClips
        .filter(c => c.trackIndex === trackIndex)
        .find(c => targetTime >= c.start && targetTime < c.start + c.effectiveDuration);
      if (!clip) {
        video.pause();
        return;
      }
      const targetSrc = `media:///${String(clip.filepath).replace(/\\/g, '/')}`;
      const localTime = Math.max(0, clip.trimIn / 1000 + (targetTime - clip.start));
      if (video.getAttribute('src') !== targetSrc) {
        video.src = targetSrc;
        video.load();
        video.addEventListener('loadeddata', () => {
          try { video.currentTime = localTime; } catch {}
        }, { once: true });
      } else {
        try { video.currentTime = localTime; } catch {}
      }
    });

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

  useEffect(() => {
    syncTimelineAudio(currentTime, isPlaying && !isSeekingRef.current);
  }, [currentTime, isPlaying, syncTimelineAudio]);

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
    timelineVideoRefs,
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
          {[2, 3].map((trackIndex) => (
            <video
              key={`timeline-video-track-${trackIndex}`}
              ref={(el) => {
                if (el) timelineVideoRefs.current.set(trackIndex, el);
                else timelineVideoRefs.current.delete(trackIndex);
              }}
              playsInline
              crossOrigin="anonymous"
              preload="auto"
            />
          ))
          {timelineAudioClips.map((clip) => (
            <audio
              key={clip.id}
              ref={(el) => {
                if (el) timelineAudioRefs.current.set(clip.id, el);
                else timelineAudioRefs.current.delete(clip.id);
              }}
              src={`media:///${clip.filepath.replace(/\\/g, '/')}`}
              preload="auto"
            />
          ))}
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
