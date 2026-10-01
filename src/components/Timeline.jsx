import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useVideo } from '../context/VideoProvider';
import { formatTechnicalTimecode } from '../utils/helpers';
import {
  asTimelineNumber,
  getClipEffectiveDurationSec,
  getClipTrackType,
  normalizeTrackIndex,
  sanitizeTimelineClip,
} from '../utils/timelineClips';

/**
 * Multi-Clip Track Timeline — DaVinci Resolve / Premiere-style
 * Renders sequential clip blocks with drag-to-trim edge handles,
 * action tools (Select, Trim, Blade, Magnet Snap), and broadcast details.
 */
// Multi-track lane definitions (rendered top-to-bottom)
const TRACK_DEFS = [
  { trackType: 'video', trackIndex: 3, label: 'V3', kind: 'video' },
  { trackType: 'video', trackIndex: 2, label: 'V2', kind: 'video' },
  { trackType: 'video', trackIndex: 1, label: 'V1', kind: 'video' },
  { trackType: 'audio', trackIndex: 1, label: 'A1', kind: 'audio' },
  { trackType: 'audio', trackIndex: 2, label: 'A2', kind: 'audio' },
  { trackType: 'audio', trackIndex: 3, label: 'A3', kind: 'audio' },
];
const TRACK_ROW_HEIGHT = 54;
const TRACK_ROW_HEIGHT_COMPACT = 32;
const MIN_TRACK_ROW_HEIGHT = 28;
const MAX_TRACK_ROW_HEIGHT = 120;

export default function Timeline({
  clips = [],
  activeClipIndex = 0,
  onActiveClipChange,
  onClipTrimChange,
  onClipTrackChange,
  onClipStartOffsetChange,
  onRemoveClip,
  onClipsChange,
  duration: totalDurationProp,
  thumbnails = {},
  mediaPool = [],
  onImportMedia,
  onImportFilePaths,
  onAddFromMediaPool,
  onMediaPoolChange,
}) {
  const { currentTime, duration: mediaDuration, isPlaying, seek, subscribe, isDimmed, setIsDimmed } = useVideo();
  const trackRef = useRef(null);
  const playheadRef = useRef(null);
  const timecodeRef = useRef(null);
  const [playheadLeft, setPlayheadLeft] = useState('0%');
  const workspaceRef = useRef(null);

  const timelineClips = useMemo(() => {
    return clips.map((clip, index) => sanitizeTimelineClip(clip, index));
  }, [clips]);

  // Tools & States
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'trim' | 'blade'
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [dragging, setDragging] = useState(null); // { type: 'trimIn' | 'trimOut', clipIndex, startX, initialTrimIn, initialTrimOut }
  const [selectedClip, setSelectedClip] = useState(null);
  const [hoverCutPos, setHoverCutPos] = useState(null); // { clipIndex, pct }
  const [timelineZoom, setTimelineZoom] = useState(1); // 1x to 10x

  // Phase 1 Audit States
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showWaveforms, setShowWaveforms] = useState(true);
  const [compactTracks, setCompactTracks] = useState(true);
  const [trackHeights, setTrackHeights] = useState({});
  const [trackResize, setTrackResize] = useState(null);

  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'source'
  const [isRecording, setIsRecording] = useState(false);
  const [isLinkingEnabled, setIsLinkingEnabled] = useState(true);
  const [isTrackLocked, setIsTrackLocked] = useState(false);
  const [markers, setMarkers] = useState([]);

  const getTrackHeight = useCallback((trackDef) => {
    const fallback = compactTracks ? TRACK_ROW_HEIGHT_COMPACT : TRACK_ROW_HEIGHT;
    return Math.max(
      MIN_TRACK_ROW_HEIGHT,
      Math.min(MAX_TRACK_ROW_HEIGHT, asTimelineNumber(trackHeights[trackDef.label], fallback))
    );
  }, [compactTracks, trackHeights]);

  // Voiceover Recording Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingStartTimeRef = useRef(0);
  const recordingDurationRef = useRef(0);

  // Time Ref for Keydown listeners
  const currentTimeRef = useRef(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const handleAddMarker = useCallback(() => {
    const timeToMark = currentTimeRef.current;
    setMarkers(prev => {
      if (prev.some(m => Math.abs(m.time - timeToMark) < 0.1)) return prev;
      return [...prev, { time: timeToMark, id: `marker-${Date.now()}` }];
    });
  }, []);

  // Keyboard Shortcuts for DaVinci Actions + Delete key
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'a':
          setActiveTool('select');
          break;
        case 't':
          setActiveTool('trim');
          break;
        case 'b':
          setActiveTool('blade');
          break;
        case 'n':
          setIsSnapEnabled(prev => !prev);
          break;
        case 'm':
          handleAddMarker();
          break;
        case 'delete':
        case 'backspace':
          if (selectedClip && activeTool === 'select') {
            e.preventDefault();
            onRemoveClip?.(selectedClip);
            setSelectedClip(null);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddMarker, selectedClip, activeTool, onRemoveClip]);

  // Sync Ctrl + Wheel zoom inside timeline track container (non-passive listener)
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setTimelineZoom(prev => {
          const delta = e.deltaY < 0 ? 0.2 : -0.2;
          return Math.max(1, Math.min(10, prev + delta));
        });
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // ── Source/Timeline View Mode Filter ───────────────────
  const handleTrackResizeDown = useCallback((e, trackDef) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackResize({
      label: trackDef.label,
      startY: e.clientY,
      startHeight: getTrackHeight(trackDef),
    });
  }, [getTrackHeight]);

  useEffect(() => {
    if (!trackResize) return;

    const handleMove = (e) => {
      const nextHeight = Math.max(
        MIN_TRACK_ROW_HEIGHT,
        Math.min(MAX_TRACK_ROW_HEIGHT, trackResize.startHeight + (e.clientY - trackResize.startY))
      );
      setTrackHeights(prev => ({ ...prev, [trackResize.label]: nextHeight }));
    };
    const handleUp = () => setTrackResize(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [trackResize]);

  const effectiveClips = useMemo(() => {
    if (viewMode === 'source' && timelineClips.length > 0) {
      return [timelineClips[activeClipIndex] || timelineClips[0]];
    }
    return timelineClips;
  }, [viewMode, timelineClips, activeClipIndex]);

  // ── Clip calculations (using millisecond trim values + startOffset for absolute positioning) ─────
  const clipMeta = useMemo(() => {
    return effectiveClips.map((clip, i) => {
      const normalized = sanitizeTimelineClip(clip, i);
      const trimIn = asTimelineNumber(normalized.trimIn, 0);
      const duration = Math.max(0, asTimelineNumber(normalized.duration, 10));
      const trimOut = Math.max(trimIn, asTimelineNumber(normalized.trimOut, duration * 1000));
      const effective = Math.max(getClipEffectiveDurationSec({ ...normalized, trimIn, trimOut, duration }), 0.001);
      const start = Math.max(0, asTimelineNumber(normalized.startOffset, 0));
      const end = start + effective;
      return {
        ...normalized,
        trimIn, trimOut, effective, start, end, index: i,
        trackType: getClipTrackType(normalized),
        trackIndex: normalizeTrackIndex(normalized.trackIndex, 1),
      };
    });
  }, [effectiveClips]);

  const renderClipMeta = useMemo(() => {
    const linkedAudio = clipMeta
      .filter(clip => clip.trackType === 'video' && clip.hasAudio !== false)
      .map(clip => {
        const audioStart = Math.max(0, asTimelineNumber(clip.audioStartOffset, clip.start));
        return {
          ...clip,
          id: `${clip.id}__linked-audio`,
          sourceClipId: clip.id,
          start: audioStart,
          end: audioStart + clip.effective,
          trackType: 'audio',
          trackIndex: normalizeTrackIndex(clip.audioTrackIndex, 1),
          isLinkedAudioMirror: true,
        };
      });

    return [...clipMeta, ...linkedAudio];
  }, [clipMeta]);

  const visibleTrackDefs = useMemo(() => {
    let maxVideoTrack = 1;
    let maxAudioTrack = 1;

    renderClipMeta.forEach((clip) => {
      const type = getClipTrackType(clip);
      const index = normalizeTrackIndex(clip.trackIndex, 1);
      if (type === 'audio') maxAudioTrack = Math.max(maxAudioTrack, index);
      else maxVideoTrack = Math.max(maxVideoTrack, index);
    });

    if (dragging && (dragging.type === 'clipDrag' || dragging.type === 'audioMirrorDrag')) {
      const initialIndex = normalizeTrackIndex(dragging.initialTrackIndex, 1);
      const rowH = Math.max(MIN_TRACK_ROW_HEIGHT, dragging.initialTrackHeight || TRACK_ROW_HEIGHT_COMPACT);
      if (dragging.initialTrackType === 'audio') {
        const projectedIndex = normalizeTrackIndex(initialIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1);
        maxAudioTrack = Math.max(maxAudioTrack, projectedIndex);
      } else {
        const projectedIndex = normalizeTrackIndex(initialIndex + Math.round(-(dragging.dragOffsetY || 0) / rowH), 1);
        maxVideoTrack = Math.max(maxVideoTrack, projectedIndex);
      }
    }

    const videoTracks = TRACK_DEFS.filter(track => track.trackType === 'video' && track.trackIndex <= maxVideoTrack);
    const audioTracks = TRACK_DEFS.filter(track => track.trackType === 'audio' && track.trackIndex <= maxAudioTrack);
    return [...videoTracks, ...audioTracks];
  }, [renderClipMeta, dragging]);

  const totalDuration = useMemo(() => {
    if (clipMeta.length === 0) return totalDurationProp || 0;
    // Total duration = max end across ALL clips
    return Math.max(asTimelineNumber(totalDurationProp, 0), ...clipMeta.map(c => asTimelineNumber(c.end, 0)));
  }, [clipMeta, totalDurationProp]);

  // Calculate current global time (currentTime is already global time from VideoProvider)
  const globalTime = currentTime;
  // Use React state for playhead position (avoids flicker from mixing DOM + React updates)
  useEffect(() => {
    const unsubscribe = subscribe((video, globalT) => {
      if (totalDuration > 0) {
        const pct = (globalT / totalDuration) * 100;
        setPlayheadLeft(`${pct}%`);
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = formatTechnicalTimecode(globalT + 3600);
      }
      // Dynamic volume meter simulation during active playback
      const volumeFillEl = document.querySelector('.volume-meter-fill');
      if (volumeFillEl) {
        if (isPlaying) {
          const baseVal = Math.random() * 40 + 40; // 40% to 80%
          const finalVal = isDimmed ? baseVal * 0.2 : baseVal;
          volumeFillEl.style.width = `${finalVal}%`;
        } else {
          volumeFillEl.style.width = '0%';
        }
      }
    });
    return unsubscribe;
  }, [subscribe, totalDuration, isPlaying, isDimmed]);

  // Unified Pointer Capture playhead seeking & drag navigation
  const handlePointerDown = useCallback((e) => {
    if (activeTool === 'blade' || !trackRef.current || totalDuration <= 0) return;
    
    // Prevent default to avoid drag-and-drop or selection conflicts
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging({ type: 'playhead' });

    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    let time = pct * totalDuration;

    // Snapping Logic
    if (isSnapEnabled) {
      const pixelsPerSecond = rect.width / totalDuration;
      const snapThresholdSec = 15 / pixelsPerSecond; // 15px radius

      let closestTarget = null;
      let minDiff = Infinity;
      const targets = [0];
      clipMeta.forEach(c => {
        targets.push(c.start);
        targets.push(c.end);
      });

      for (const t of targets) {
        const diff = Math.abs(time - t);
        if (diff < snapThresholdSec && diff < minDiff) {
          minDiff = diff;
          closestTarget = t;
        }
      }

      if (closestTarget !== null) {
        time = closestTarget;
      }
    }

    seek(time);
  }, [activeTool, totalDuration, isSnapEnabled, clipMeta, seek]);

  const handleRulerPointerDown = useCallback((e) => {
    if (!trackRef.current || totalDuration <= 0) return;
    
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging({ type: 'playhead' });

    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    let time = pct * totalDuration;

    // Snapping Logic
    if (isSnapEnabled) {
      const pixelsPerSecond = rect.width / totalDuration;
      const snapThresholdSec = 15 / pixelsPerSecond; // 15px radius

      let closestTarget = null;
      let minDiff = Infinity;
      const targets = [0];
      clipMeta.forEach(c => {
        targets.push(c.start);
        targets.push(c.end);
      });

      for (const t of targets) {
        const diff = Math.abs(time - t);
        if (diff < snapThresholdSec && diff < minDiff) {
          minDiff = diff;
          closestTarget = t;
        }
      }

      if (closestTarget !== null) {
        time = closestTarget;
      }
    }

    seek(time);
  }, [totalDuration, isSnapEnabled, clipMeta, seek]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging || dragging.type !== 'playhead' || !trackRef.current || totalDuration <= 0) return;

    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    let time = pct * totalDuration;

    // Snapping Logic
    if (isSnapEnabled) {
      const pixelsPerSecond = rect.width / totalDuration;
      const snapThresholdSec = 15 / pixelsPerSecond; // 15px radius

      let closestTarget = null;
      let minDiff = Infinity;
      const targets = [0];
      clipMeta.forEach(c => {
        targets.push(c.start);
        targets.push(c.end);
      });

      for (const t of targets) {
        const diff = Math.abs(time - t);
        if (diff < snapThresholdSec && diff < minDiff) {
          minDiff = diff;
          closestTarget = t;
        }
      }

      if (closestTarget !== null) {
        time = closestTarget;
      }
    }

    seek(time);
  }, [dragging, totalDuration, isSnapEnabled, clipMeta, seek]);

  const handlePointerUp = useCallback((e) => {
    if (dragging && dragging.type === 'playhead') {
      setDragging(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // noop
      }
    }
  }, [dragging]);
  // Pointer-based clip dragging and snapping handlers
  const handleClipPointerDown = useCallback((e, index, clickedClip = null) => {
    if (isTrackLocked) return;
    
    const clip = effectiveClips[index];
    if (!clip) return;

    const fullIndex = timelineClips.findIndex(c => c.id === clip.id);
    if (fullIndex === -1) return;

    const targetClip = clickedClip || clip;

    // Slip trimming mode
    if (activeTool === 'trim') {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedClip(clip.id);
      if (fullIndex !== activeClipIndex) {
        onActiveClipChange?.(fullIndex);
        seek(clipMeta[index].start);
      }
      setDragging({
        type: 'slipDrag',
        clipIndex: index,
        clipId: clip.id,
        fullIndex: fullIndex,
        startX: e.clientX,
        initialTrimIn: asTimelineNumber(clip.trimIn, 0),
        initialTrimOut: asTimelineNumber(clip.trimOut, asTimelineNumber(clip.duration, 10) * 1000),
      });
      return;
    }

    if (activeTool !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const initialTrackType = getClipTrackType(targetClip);
    const initialTrackIndex = normalizeTrackIndex(targetClip.trackIndex, 1);
    const initialTrackDef = TRACK_DEFS.find(
      track => track.trackType === initialTrackType && track.trackIndex === initialTrackIndex
    );

    setSelectedClip(clip.id);
    if (fullIndex !== activeClipIndex) {
      onActiveClipChange?.(fullIndex);
      seek(clipMeta[index].start);
    }

    setDragging({
      type: 'clipDrag',
      clipIndex: index,
      clipId: clip.id,
      draggedClipId: targetClip.id,
      fullIndex: fullIndex,
      startX: e.clientX,
      startY: e.clientY,
      dragOffsetX: 0,
      dragOffsetY: 0,
      initialStartOffset: asTimelineNumber(targetClip.startOffset ?? targetClip.start, 0),
      initialTrackType,
      initialTrackIndex,
      initialTrackHeight: initialTrackDef ? getTrackHeight(initialTrackDef) : (compactTracks ? TRACK_ROW_HEIGHT_COMPACT : TRACK_ROW_HEIGHT),
    });
  }, [activeTool, timelineClips, effectiveClips, activeClipIndex, clipMeta, onActiveClipChange, seek, isTrackLocked, getTrackHeight, compactTracks]);

  const handleClipPointerMove = useCallback((e, index) => {
    if (isTrackLocked) return;

    const clip = effectiveClips[index];
    if (!clip) return;

    if (dragging && dragging.type === 'slipDrag' && dragging.clipId === clip.id) {
      e.preventDefault();
      e.stopPropagation();
      const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
      const deltaX = e.clientX - dragging.startX;
      // Symmetrical Slip-Trim calculation
      const deltaMs = (deltaX / trackWidth) * Math.max(0.001, totalDuration) * 1000;

      const durationMs = Math.max(dragging.initialTrimOut, asTimelineNumber(clip.duration, 10) * 1000);
      const currentWidthMs = (dragging.initialTrimOut - dragging.initialTrimIn);

      // Slide trim window
      let newTrimIn = dragging.initialTrimIn - deltaMs;
      let newTrimOut = dragging.initialTrimOut - deltaMs;

      if (newTrimIn < 0) {
        newTrimIn = 0;
        newTrimOut = currentWidthMs;
      } else if (newTrimOut > durationMs) {
        newTrimOut = durationMs;
        newTrimIn = durationMs - currentWidthMs;
      }

      onClipTrimChange?.(clip.id, Math.round(newTrimIn), Math.round(newTrimOut));
      return;
    }

    if (dragging && dragging.type === 'clipDrag' && dragging.clipId === clip.id) {
      e.preventDefault();
      e.stopPropagation();
      const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
      const deltaX = e.clientX - dragging.startX;
      const deltaY = e.clientY - dragging.startY;

      let finalDeltaX = deltaX;
      if (isSnapEnabled) {
        const currentClipMeta = clipMeta[index];
        if (currentClipMeta) {
          const safeDuration = Math.max(0.001, totalDuration);
          const clipStartPx = (currentClipMeta.start / safeDuration) * trackWidth;
          const clipWidthPx = (currentClipMeta.effective / safeDuration) * trackWidth;
          const currentLeftPx = clipStartPx + deltaX;
          const currentRightPx = clipStartPx + clipWidthPx + deltaX;

          const playheadPx = (currentTime / safeDuration) * trackWidth;
          const targetsPx = [0, playheadPx];
          clipMeta.forEach((c) => {
            if (c.id !== clip.id) {
              targetsPx.push((c.start / safeDuration) * trackWidth);
              targetsPx.push((c.end / safeDuration) * trackWidth);
            }
          });

          let minDiff = Infinity;
          let bestDeltaX = deltaX;
          for (const targetPx of targetsPx) {
            const diffLeft = Math.abs(currentLeftPx - targetPx);
            if (diffLeft < 15 && diffLeft < minDiff) {
              minDiff = diffLeft;
              bestDeltaX = targetPx - clipStartPx;
            }
            const diffRight = Math.abs(currentRightPx - targetPx);
            if (diffRight < 15 && diffRight < minDiff) {
              minDiff = diffRight;
              bestDeltaX = targetPx - clipStartPx - clipWidthPx;
            }
          }
          finalDeltaX = bestDeltaX;
        }
      }

      setDragging(prev => {
        if (!prev || prev.type !== 'clipDrag') return prev;
        return {
          ...prev,
          dragOffsetX: finalDeltaX,
          dragOffsetY: deltaY,
        };
      });
    }
  }, [dragging, isSnapEnabled, clipMeta, totalDuration, currentTime, effectiveClips, onClipTrimChange, isTrackLocked]);

  const handleAudioMirrorPointerDown = useCallback((e, clip) => {
    if (isTrackLocked) return;
    if (isLinkingEnabled) {
      // Pass the audio mirror as clickedClip so draggedClipId is set to the mirror's id
      handleClipPointerDown(e, clip.index, clip);
      return;
    }
    if (activeTool !== 'select') return;

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedClip(clip.sourceClipId);

    const initialTrackIndex = normalizeTrackIndex(clip.trackIndex, 1);
    const initialTrackDef = TRACK_DEFS.find(track => track.trackType === 'audio' && track.trackIndex === initialTrackIndex);
    setDragging({
      type: 'audioMirrorDrag',
      mirrorId: clip.id,
      clipId: clip.sourceClipId,
      startX: e.clientX,
      startY: e.clientY,
      dragOffsetX: 0,
      dragOffsetY: 0,
      initialStartOffset: asTimelineNumber(clip.start, 0),
      initialTrackType: 'audio',
      initialTrackIndex,
      initialTrackHeight: initialTrackDef ? getTrackHeight(initialTrackDef) : (compactTracks ? TRACK_ROW_HEIGHT_COMPACT : TRACK_ROW_HEIGHT),
    });
  }, [activeTool, compactTracks, getTrackHeight, handleClipPointerDown, isLinkingEnabled, isTrackLocked]);

  const handleAudioMirrorPointerMove = useCallback((e, clip) => {
    if (!dragging || dragging.type !== 'audioMirrorDrag' || dragging.mirrorId !== clip.id) return;
    e.preventDefault();
    e.stopPropagation();

    const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
    const deltaX = e.clientX - dragging.startX;
    const deltaY = e.clientY - dragging.startY;

    let finalDeltaX = deltaX;
    if (isSnapEnabled) {
      const safeDuration = Math.max(0.001, totalDuration);
      const clipStartPx = (clip.start / safeDuration) * trackWidth;
      const clipWidthPx = (clip.effective / safeDuration) * trackWidth;
      const currentLeftPx = clipStartPx + deltaX;
      const currentRightPx = clipStartPx + clipWidthPx + deltaX;
      const targetsPx = [0, (currentTime / safeDuration) * trackWidth];

      renderClipMeta.forEach((target) => {
        if (target.id !== clip.id) {
          targetsPx.push((target.start / safeDuration) * trackWidth);
          targetsPx.push((target.end / safeDuration) * trackWidth);
        }
      });

      let minDiff = Infinity;
      let bestDeltaX = deltaX;
      for (const targetPx of targetsPx) {
        const diffLeft = Math.abs(currentLeftPx - targetPx);
        if (diffLeft < 15 && diffLeft < minDiff) {
          minDiff = diffLeft;
          bestDeltaX = targetPx - clipStartPx;
        }
        const diffRight = Math.abs(currentRightPx - targetPx);
        if (diffRight < 15 && diffRight < minDiff) {
          minDiff = diffRight;
          bestDeltaX = targetPx - clipStartPx - clipWidthPx;
        }
      }
      finalDeltaX = bestDeltaX;
    }

    setDragging(prev => prev && prev.type === 'audioMirrorDrag'
      ? { ...prev, dragOffsetX: finalDeltaX, dragOffsetY: deltaY }
      : prev
    );
  }, [currentTime, dragging, isSnapEnabled, renderClipMeta, totalDuration]);

  const handleAudioMirrorPointerUp = useCallback((e, clip) => {
    if (!dragging || dragging.type !== 'audioMirrorDrag' || dragging.mirrorId !== clip.id) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}

    const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
    const deltaSec = (dragging.dragOffsetX || 0) / trackWidth * Math.max(0.001, totalDuration);
    const newAudioStartOffset = Math.max(0, dragging.initialStartOffset + deltaSec);
    const rowH = Math.max(MIN_TRACK_ROW_HEIGHT, dragging.initialTrackHeight || (compactTracks ? TRACK_ROW_HEIGHT_COMPACT : TRACK_ROW_HEIGHT));
    const newAudioTrackIndex = normalizeTrackIndex(dragging.initialTrackIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1);

    onClipsChange?.(prev => prev.map((item, itemIndex) => {
      if (item.id !== clip.sourceClipId) return item;
      return sanitizeTimelineClip({
        ...item,
        audioStartOffset: newAudioStartOffset,
        audioTrackIndex: newAudioTrackIndex,
      }, itemIndex);
    }));
    setDragging(null);
  }, [compactTracks, dragging, onClipsChange, totalDuration]);

  const handleClipPointerUp = useCallback((e, index) => {
    const clip = effectiveClips[index];
    if (!clip) return;

    if (dragging && dragging.type === 'slipDrag' && dragging.clipId === clip.id) {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      setDragging(null);
      return;
    }

    if (dragging && dragging.type === 'clipDrag' && dragging.clipId === clip.id) {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}

      const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
      const deltaSec = (dragging.dragOffsetX || 0) / trackWidth * Math.max(0.001, totalDuration);
      const newStartOffset = Math.max(0, dragging.initialStartOffset + deltaSec);
      const rowH = Math.max(MIN_TRACK_ROW_HEIGHT, dragging.initialTrackHeight || (compactTracks ? TRACK_ROW_HEIGHT_COMPACT : TRACK_ROW_HEIGHT));

      // Check if user actually dragged the linked audio mirror (vs the video clip itself)
      const draggedIsAudioMirror = Boolean(dragging.draggedClipId && dragging.draggedClipId.endsWith('__linked-audio'));

      if (onClipsChange) {
        onClipsChange(prev => prev.map((item, itemIndex) => {
          if (item.id !== clip.id) return item;

          if (draggedIsAudioMirror) {
            // ── User dragged the linked audio mirror ──
            // Only move audio track index vertically; video track is unchanged
            const nextAudioIdx = normalizeTrackIndex(
              dragging.initialTrackIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1
            );
            return sanitizeTimelineClip({
              ...item,
              startOffset: newStartOffset,
              audioStartOffset: newStartOffset,
              audioTrackIndex: nextAudioIdx,
              // trackType + trackIndex (video) stay unchanged
            }, itemIndex);
          } else if (dragging.initialTrackType === 'audio') {
            // ── Dragging a standalone audio clip ──
            const nextIdx = normalizeTrackIndex(
              dragging.initialTrackIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1
            );
            return sanitizeTimelineClip({
              ...item,
              trackType: 'audio',
              trackIndex: nextIdx,
              startOffset: newStartOffset,
              audioStartOffset: item.audioStartOffset ?? item.startOffset ?? 0,
            }, itemIndex);
          } else {
            // ── User dragged the video clip ──
            // Only move video track index vertically; audio track is unchanged
            const nextVideoIdx = normalizeTrackIndex(
              dragging.initialTrackIndex + Math.round(-(dragging.dragOffsetY || 0) / rowH), 1
            );
            return sanitizeTimelineClip({
              ...item,
              trackType: 'video',
              trackIndex: nextVideoIdx,
              startOffset: newStartOffset,
              // Horizontally sync audio if linking is on, but leave audioTrackIndex alone
              audioStartOffset: isLinkingEnabled ? newStartOffset : (item.audioStartOffset ?? item.startOffset ?? 0),
              audioTrackIndex: item.audioTrackIndex ?? 1,
            }, itemIndex);
          }
        }));
      } else {
        if (draggedIsAudioMirror) {
          const nextAudioIdx = normalizeTrackIndex(dragging.initialTrackIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1);
          onClipTrackChange?.(clip.id, 'audio', nextAudioIdx);
        } else if (dragging.initialTrackType === 'audio') {
          const nextIdx = normalizeTrackIndex(dragging.initialTrackIndex + Math.round((dragging.dragOffsetY || 0) / rowH), 1);
          onClipTrackChange?.(clip.id, 'audio', nextIdx);
        } else {
          const nextVideoIdx = normalizeTrackIndex(dragging.initialTrackIndex + Math.round(-(dragging.dragOffsetY || 0) / rowH), 1);
          onClipTrackChange?.(clip.id, 'video', nextVideoIdx);
        }
        onClipStartOffsetChange?.(clip.id, newStartOffset);
      }

      setDragging(null);
    }
  }, [dragging, totalDuration, compactTracks, effectiveClips, onClipTrackChange, onClipStartOffsetChange, onClipsChange, isLinkingEnabled]);

  // Trim handle drag start
  const handleTrimDown = useCallback((e, clipIndex, type) => {
    if (isTrackLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const clip = effectiveClips[clipIndex];
    const meta = clipMeta[clipIndex];
    if (!clip) return;
    const fullIndex = timelineClips.findIndex(c => c.id === clip.id);
    setDragging({
      type,
      clipIndex,
      clipId: clip.id,
      fullIndex,
      startX: e.clientX,
      initialTrimIn: asTimelineNumber(clip.trimIn, 0),
      initialTrimOut: asTimelineNumber(clip.trimOut, asTimelineNumber(clip.duration, 10) * 1000),
      initialStart: asTimelineNumber(meta?.start, asTimelineNumber(clip.startOffset, 0)),
      initialEnd: asTimelineNumber(meta?.end, asTimelineNumber(clip.startOffset, 0) + getClipEffectiveDurationSec(clip)),
      initialStartOffset: asTimelineNumber(clip.startOffset, 0),
    });
  }, [timelineClips, effectiveClips, clipMeta, isTrackLocked]);

  // Blade splitting click handler
  const handleBladeClick = useCallback((e, clipIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTrackLocked) return;
    if (activeTool !== 'blade' || !onClipsChange) return;

    const clip = clipMeta[clipIndex];
    if (!clip) return;

    const fullIndex = timelineClips.findIndex(c => c.id === clip.id);
    if (fullIndex === -1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
    const clipDuration = (clip.trimOut - clip.trimIn) / 1000;
    const localOffsetSec = pct * clipDuration;
    let splitTimeMs = clip.trimIn + (localOffsetSec * 1000);

    // Ensure split parts meet minimum duration requirement of 200ms
    const minDurMs = 200;
    if (splitTimeMs - clip.trimIn < minDurMs || clip.trimOut - splitTimeMs < minDurMs) {
      return; // Too short to split
    }

    const idA = `clip-${Date.now()}-${Math.random().toString(36).substring(5)}-a`;
    const idB = `clip-${Date.now()}-${Math.random().toString(36).substring(5)}-b`;

    splitTimeMs = Math.round(splitTimeMs);
    const baseClip = timelineClips[fullIndex];
    const clipA = sanitizeTimelineClip({
      ...baseClip,
      id: idA,
      trimOut: splitTimeMs,
    }, fullIndex);
    const clipB = sanitizeTimelineClip({
      ...baseClip,
      id: idB,
      trimIn: splitTimeMs,
      startOffset: asTimelineNumber(baseClip.startOffset, 0) + (splitTimeMs - clip.trimIn) / 1000,
    }, fullIndex + 1);

    const newClips = [...timelineClips];
    newClips.splice(fullIndex, 1, clipA, clipB);
    onClipsChange(newClips);
    setHoverCutPos(null);
  }, [timelineClips, clipMeta, activeTool, onClipsChange, isTrackLocked]);

  const handleBladeMouseMove = useCallback((e, clipIndex) => {
    if (activeTool !== 'blade') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverCutPos({ clipIndex, pct: Math.max(0, Math.min(1, x / Math.max(1, rect.width))) });
  }, [activeTool]);

  const handleBladeMouseLeave = useCallback(() => {
    setHoverCutPos(null);
  }, []);

  // HTML5 Drag and Drop for Selection Reordering (Legacy, kept for compatibility/stub)
  const handleDragStart = (e, index) => {
    e.preventDefault();
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
  };

  const handleVoiceoverToggle = async () => {
    if (isTrackLocked) return;
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunksRef.current = [];
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          const audioUrl = URL.createObjectURL(audioBlob);
          const elapsedMs = Date.now() - recordingStartTimeRef.current;
          
          const newVoiceoverClip = sanitizeTimelineClip({
            id: `recorded-${Date.now()}`,
            filename: `Voiceover_${new Date().toLocaleTimeString().replace(/\s/g, '').replace(/:/g, '')}.wav`,
            filepath: audioUrl,
            duration: elapsedMs / 1000,
            width: 0,
            height: 0,
            fps: 0,
            aspect: 'audio',
            trimIn: 0,
            trimOut: elapsedMs,
            trackType: 'audio',
            trackIndex: 1,
            startOffset: currentTimeRef.current,
          });

          if (onClipsChange) {
            onClipsChange(prev => [...prev, newVoiceoverClip]);
          }

          // Clean up stream tracks
          stream.getTracks().forEach(track => track.stop());
        };

        recordingStartTimeRef.current = Date.now();
        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Failed to start voiceover recording:", err);
        alert("Microphone permission denied or recording device unavailable.");
      }
    }
  };

  const handleFlagAsset = () => {
    const activeClip = timelineClips[activeClipIndex];
    if (!activeClip || !onMediaPoolChange) return;
    onMediaPoolChange(prev => prev.map(asset => {
      if (asset.filepath === activeClip.filepath) {
        return {
          ...asset,
          flagged: !asset.flagged
        };
      }
      return asset;
    }));
  };

  // Handle move/up listeners for dragging (trim operations)
  useEffect(() => {
    if (!dragging) return;

    if (dragging.type === 'trimIn' || dragging.type === 'trimOut') {
      const handleMove = (e) => {
        const clip = effectiveClips[dragging.clipIndex];
        const currentClipMeta = clipMeta[dragging.clipIndex];
        const trackWidth = Math.max(1, trackRef.current ? trackRef.current.getBoundingClientRect().width : (workspaceRef.current?.getBoundingClientRect().width || 1000));
        if (!clip || !currentClipMeta) return;
        
        const deltaX = e.clientX - dragging.startX;
        const safeDuration = Math.max(0.001, totalDuration);
        const deltaSec = (deltaX / trackWidth) * safeDuration;

        let proposedGlobalTime = 0;
        const initialStart = asTimelineNumber(dragging.initialStart, currentClipMeta.start);
        const initialEnd = asTimelineNumber(dragging.initialEnd, currentClipMeta.end);

        if (dragging.type === 'trimIn') {
          proposedGlobalTime = initialStart + deltaSec;
        } else {
          proposedGlobalTime = initialEnd + deltaSec;
        }

        // Snapping Implementation (15-pixel snapping radius)
        if (isSnapEnabled) {
          const pixelsPerSecond = trackWidth / safeDuration;
          const snapThresholdSec = 15 / pixelsPerSecond; // 15-pixel radius

          // Snap Targets: playhead and other clip boundaries
          const targets = [currentTime];
          clipMeta.forEach((c, idx) => {
            if (idx !== dragging.clipIndex) {
              targets.push(c.start);
              targets.push(c.end);
            }
          });

          let closestTarget = null;
          let minDiff = Infinity;
          for (const t of targets) {
            const diff = Math.abs(proposedGlobalTime - t);
            if (diff < snapThresholdSec && diff < minDiff) {
              minDiff = diff;
              closestTarget = t;
            }
          }

          if (closestTarget !== null) {
            proposedGlobalTime = closestTarget;
          }
        }

        if (dragging.type === 'trimIn') {
          const newTrimIn = dragging.initialTrimIn + (proposedGlobalTime - initialStart) * 1000;
          const maxTrimIn = dragging.initialTrimOut - 200; // minimum duration 200ms
          const finalTrimIn = Math.max(0, Math.min(newTrimIn, maxTrimIn));
          onClipTrimChange?.(clip.id, finalTrimIn, asTimelineNumber(clip.trimOut, asTimelineNumber(clip.duration, 10) * 1000));
          const trimDeltaSec = (finalTrimIn - dragging.initialTrimIn) / 1000;
          onClipStartOffsetChange?.(clip.id, Math.max(0, asTimelineNumber(dragging.initialStartOffset, 0) + trimDeltaSec));
        } else {
          const clipTrimIn = asTimelineNumber(clip.trimIn, 0);
          const newTrimOut = clipTrimIn + (proposedGlobalTime - initialStart) * 1000;
          const minTrimOut = clipTrimIn + 200;
          const maxTrimOut = Math.max(minTrimOut, asTimelineNumber(clip.duration, 10) * 1000);
          const finalTrimOut = Math.min(maxTrimOut, Math.max(newTrimOut, minTrimOut));
          onClipTrimChange?.(clip.id, clipTrimIn, finalTrimOut);
        }
      };
      const handleUp = () => setDragging(null);

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      return () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
    }
  }, [dragging, effectiveClips, totalDuration, isSnapEnabled, currentTime, clipMeta, onClipTrimChange, onClipStartOffsetChange]);

  // ── Broadcast ticks generation ────────────────────────
  const rulerTicks = useMemo(() => {
    if (totalDuration <= 0) return [];
    const ticks = [];
    let majorStep = 5; // seconds
    let minorStep = 1; // seconds

    if (totalDuration < 10) {
      majorStep = 1;
      minorStep = 0.25;
    } else if (totalDuration < 30) {
      majorStep = 2;
      minorStep = 0.5;
    } else if (totalDuration < 60) {
      majorStep = 5;
      minorStep = 1;
    } else {
      majorStep = 10;
      minorStep = 2;
    }

    for (let t = 0; t <= totalDuration; t += minorStep) {
      const isMajor = Math.floor(t % majorStep) === 0 || Math.abs((t % majorStep) - majorStep) < 0.001;
      ticks.push({ time: t, type: isMajor ? 'major' : 'minor' });
    }
    return ticks;
  }, [totalDuration]);

  return (
    <div className="timeline-container">
      {/* ── DAVINCI ACTION TOOLBAR ── */}
      <div className="timeline-toolbar">
        <div className="toolbar-left">
          {/* Timeline View Options Dropdown */}
          <div style={{ position: 'relative' }}>
            <button 
              className={`toolbar-icon-btn ${viewOptionsOpen ? 'active' : ''}`}
              onClick={() => setViewOptionsOpen(prev => !prev)}
              title="Timeline View Options"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {viewOptionsOpen && (
              <div className="view-options-dropdown">
                <label className="dropdown-item">
                  <input 
                    type="checkbox" 
                    checked={showThumbnails} 
                    onChange={(e) => setShowThumbnails(e.target.checked)} 
                  />
                  <span>Show Video Thumbnails</span>
                </label>
                <label className="dropdown-item">
                  <input 
                    type="checkbox" 
                    checked={showWaveforms} 
                    onChange={(e) => setShowWaveforms(e.target.checked)} 
                  />
                  <span>Show Audio Waveforms</span>
                </label>
                <label className="dropdown-item">
                  <input 
                    type="checkbox" 
                    checked={compactTracks} 
                    onChange={(e) => setCompactTracks(e.target.checked)} 
                  />
                  <span>Compact Tracks</span>
                </label>
              </div>
            )}
          </div>

          {/* Source/Timeline Viewer Toggle */}
          <button 
            className={`toolbar-icon-btn ${viewMode === 'source' ? 'active' : ''}`}
            onClick={() => setViewMode(prev => prev === 'timeline' ? 'source' : 'timeline')}
            title="Source / Timeline Toggle"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>

          {/* Voiceover / Live Save mic recorder */}
          <button 
            className={`toolbar-icon-btn ${isRecording ? 'recording' : ''}`}
            onClick={handleVoiceoverToggle}
            title={isRecording ? "Stop Recording Voiceover" : "Record Voiceover (Live Mic)"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill={isRecording ? "currentColor" : "none"} />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </button>
        </div>

        <div className="toolbar-center">
          {/* Select Tool (A) */}
          <button
            className={`action-tool-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title="Selection Tool (A)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="4,2 4,22 9,17 14,22 17,19 12,14 18,14" />
            </svg>
          </button>

          {/* Trim Tool (T) */}
          <button
            className={`action-tool-btn ${activeTool === 'trim' ? 'active' : ''}`}
            onClick={() => setActiveTool('trim')}
            title="Trim Mode (T)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 4H4v16h4M16 4h4v16h-4" />
            </svg>
          </button>

          {/* Blade Tool (B) */}
          <button
            className={`action-tool-btn ${activeTool === 'blade' ? 'active' : ''}`}
            onClick={() => setActiveTool('blade')}
            title="Blade Razor Tool (B)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2L4 12v6h6L20 8zM14 2l8 8" />
            </svg>
          </button>

          {/* Snapping Magnet (N) */}
          <button
            className={`action-tool-btn snap-toggle-btn ${isSnapEnabled ? 'enabled' : ''}`}
            onClick={() => setIsSnapEnabled(prev => !prev)}
            title="Snapping Toggle (N)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 10c0-3.87 3.13-7 7-7s7 3.13 7 7v4c0 .55-.45 1-1 1s-1-.45-1-1v-4c0-2.76-2.24-5-5-5s-5 2.24-5 5v4c0 .55-.45 1-1 1s-1-.45-1-1v-4z M13 19v3h-2v-3" />
            </svg>
          </button>

          {/* Link Selection Icon */}
          <button 
            className={`action-tool-btn ${isLinkingEnabled ? 'active' : ''}`}
            onClick={() => setIsLinkingEnabled(prev => !prev)}
            title="Linked Selection"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>

          {/* Lock Icon */}
          <button 
            className={`action-tool-btn ${isTrackLocked ? 'active' : ''}`}
            onClick={() => setIsTrackLocked(prev => !prev)}
            title={isTrackLocked ? "Unlock Timeline Tracks" : "Lock Timeline Tracks"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill={isTrackLocked ? "currentColor" : "none"} />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>

          <div className="toolbar-separator" />

          {/* Flag Icon */}
          <button 
            className="action-tool-btn" 
            onClick={handleFlagAsset}
            title="Flag Active Asset in Media Pool"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
            </svg>
          </button>

          {/* Marker Icon */}
          <button 
            className="action-tool-btn" 
            onClick={handleAddMarker}
            title="Add Marker (M)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </button>

          <div className="toolbar-separator" />

          {/* Zoom Out Icon */}
          <button className="action-tool-btn zoom-icon" onClick={() => setTimelineZoom(prev => Math.max(1, prev - 1))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          {/* Zoom Slider */}
          <input
            type="range"
            min="1"
            max="10"
            step="0.1"
            value={timelineZoom}
            onChange={(e) => setTimelineZoom(parseFloat(e.target.value))}
            className="timeline-zoom-slider"
          />

          {/* Zoom In Icon */}
          <button className="action-tool-btn zoom-icon" onClick={() => setTimelineZoom(prev => Math.min(10, prev + 1))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        </div>

        {/* Right-side Volume / Audio Monitor */}
        <div className="toolbar-right volume-monitor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="volume-icon">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
          </svg>
          <div className="volume-meter-bar">
            <div className="volume-meter-fill" style={{ width: '0%' }} />
          </div>
          <button
            className={`dim-btn ${isDimmed ? 'active' : ''}`}
            onClick={() => setIsDimmed(prev => !prev)}
          >
            DIM
          </button>
        </div>
      </div>

      {/* ── LOWER TIMELINE SECTION: Media Pool + Tracks ── */}
      <div className="timeline-lower-layout">
        {/* Media Pool Panel */}
        <div
          className="media-pool-panel"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over'); }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            const validFiles = files.filter(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.name));
            if (validFiles.length > 0 && onImportFilePaths) {
              const paths = validFiles.map(f => f.path).filter(Boolean);
              if (paths.length > 0) await onImportFilePaths(paths);
            }
          }}
        >
          <div className="media-pool-header">
            <h4>Media Pool</h4>
            <button className="import-media-btn" onClick={onImportMedia}>
              Import Media
            </button>
          </div>
          <div className="media-pool-list">
            {mediaPool.length === 0 ? (
              <div className="media-pool-empty">No clips · Drop files or click Import</div>
            ) : (
              mediaPool.map((asset) => (
                <div
                  key={asset.id}
                  className="media-pool-item"
                  onClick={() => onAddFromMediaPool(asset)}
                  title="Click to add clip to timeline sequence"
                >
                  <div className="media-item-info">
                    <span className="media-item-name">
                      {asset.filename}
                      {asset.flagged && (
                        <span className="media-flag-indicator" style={{ color: '#e74c3c', marginLeft: '6px' }}>🚩</span>
                      )}
                    </span>
                    <span className="media-item-dur">{(asset.duration || 0).toFixed(1)}s</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tracks Area (Sidebar + Tracks Zone) */}
        <div className="timeline-workspace-wrapper">
          {/* Dedicated Track Header Sidebar (fixed width 150px) */}
          <div className="timeline-sidebar">
            {/* Far-Left Timecode Block */}
            <div className="timeline-timecode-box">
              <span ref={timecodeRef} className="technical-timecode">
                {formatTechnicalTimecode(globalTime + 3600)}
              </span>
            </div>

            {/* Track Headers — 6 lanes */}
            {visibleTrackDefs.map((trackDef) => {
              const rowH = getTrackHeight(trackDef);
              const isVideo = trackDef.kind === 'video';
              return (
                <div
                  key={trackDef.label}
                  className={`track-header-box ${isVideo ? 'v-track-header' : 'a-track-header'} ${trackDef.label.toLowerCase()}-header`}
                  style={{ height: `${rowH}px` }}
                >
                  <div className={`left-color-strip ${isVideo ? 'v-strip' : 'a-strip'}`} />
                  <span className={`track-badge ${isVideo ? 'v-badge' : 'a-badge'}`}>{trackDef.label}</span>
                  {trackDef.trackIndex === 1 && (
                    <button 
                      className={`header-icon-btn ${isTrackLocked ? 'active' : ''}`} 
                      onClick={() => setIsTrackLocked(prev => !prev)}
                      title="Lock track"
                    >
                      {isTrackLocked ? '🔒' : '🔓'}
                    </button>
                  )}
                  <div
                    className="track-row-resize-handle"
                    onPointerDown={(e) => handleTrackResizeDown(e, trackDef)}
                    title={`Resize ${trackDef.label}`}
                  />
                </div>
              );
            })}
          </div>

          {/* Scrollable Tracks Area */}
          <div 
            className="timeline-tracks-area" 
            ref={workspaceRef}
          >
            {/* The Ruler & Ticks */}
            <div 
              className="timeline-ruler-track" 
              style={{ width: `${timelineZoom * 100}%` }}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {/* Markers Diamond Pins */}
              {markers.map((marker) => {
                const leftPct = totalDuration > 0 ? (marker.time / totalDuration) * 100 : 0;
                return (
                  <div
                    key={marker.id}
                    className="timeline-marker-pin"
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: '2px',
                      transform: 'translateX(-50%)',
                      zIndex: 100,
                      cursor: 'pointer',
                    }}
                    title={`Marker at ${formatTechnicalTimecode(marker.time + 3600)}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#00ffff" stroke="#008888" strokeWidth="2">
                      <polygon points="12,2 22,12 12,22 2,12" />
                    </svg>
                  </div>
                );
              })}

              <div className="timeline-ruler-ticks">
                {rulerTicks.map((tick, idx) => {
                  const leftPct = (tick.time / totalDuration) * 100;
                  return (
                    <div 
                      key={idx} 
                      className={`ruler-tick ${tick.type}`} 
                      style={{ left: `${leftPct}%` }}
                    >
                      <div className={`ruler-tick-mark ${tick.type}`} />
                      {tick.type === 'major' && (
                        <span className="ruler-tick-label">
                          {formatTechnicalTimecode(tick.time + 3600)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Multi-Track Lanes (V3 → V2 → V1 → A1 → A2 → A3) ── */}
            {visibleTrackDefs.map((trackDef, trackRow) => {
              const rowH = getTrackHeight(trackDef);
              const isVideo = trackDef.kind === 'video';
              const laneClips = renderClipMeta.filter(clip => {
                const clipType = getClipTrackType(clip);
                const clipIndex = normalizeTrackIndex(clip.trackIndex, 1);
                return clipType === trackDef.trackType && Number(clipIndex) === Number(trackDef.trackIndex);
              });

              return (
                <div
                  key={trackDef.label}
                  className={`track-lane-row ${isVideo ? 'v-lane-row' : 'a-lane-row'} ${trackDef.label.toLowerCase()}-lane-row`}
                  style={{ width: `${timelineZoom * 100}%`, height: `${rowH}px` }}
                  data-track-type={trackDef.trackType}
                  data-track-index={trackDef.trackIndex}
                  data-track-row={trackRow}
                >
                  <div
                    className={`track-lane ${isVideo ? 'video-lane' : 'audio-lane'} ${activeTool === 'blade' ? 'blade-cursor' : ''}`}
                    ref={trackDef.label === 'V1' ? trackRef : undefined}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  >
                    {laneClips.length === 0 && trackDef.label === 'V1' && timelineClips.length === 0 && (
                      <div className="track-empty" onMouseDown={(e) => e.stopPropagation()}>
                        Import media and click to add clips
                      </div>
                    )}

                    {laneClips.map((clip) => {
                      const safeDuration = Math.max(0.001, totalDuration);
                      const leftPct = Math.max(0, (clip.start / safeDuration) * 100);
                      const widthPct = Math.max(0.001, (clip.effective / safeDuration) * 100);
                      const sourceClipId = clip.sourceClipId || clip.id;
                      const isClipSelected = sourceClipId === selectedClip;
                      const frames = thumbnails[clip.filepath] || [];

                      // Drag offset for this clip
                      // isActuallyDragged = this clip is the element the pointer went down on
                      const isActuallyDragged = dragging && dragging.type === 'clipDrag' && (
                        dragging.draggedClipId === clip.id
                      );
                      // isLinkedFollower = clip is linked to the dragged element (follows X but NOT Y)
                      const isLinkedFollower = dragging && dragging.type === 'clipDrag' && isLinkingEnabled && (
                        // Video clip follows when its audio mirror is dragged
                        (dragging.draggedClipId && dragging.draggedClipId.endsWith('__linked-audio') && dragging.clipId === clip.id) ||
                        // Audio mirror follows when the video clip is dragged
                        (clip.sourceClipId && dragging.clipId === clip.sourceClipId && !isActuallyDragged)
                      );
                      const isAudioMirrorDragging = dragging && dragging.type === 'audioMirrorDrag' && dragging.mirrorId === clip.id;

                      const dragOffset = (isActuallyDragged || isLinkedFollower || isAudioMirrorDragging) ? (dragging.dragOffsetX || 0) : 0;
                      // Only apply Y offset to the actual element being dragged (not the linked follower)
                      const dragOffsetY = isActuallyDragged || isAudioMirrorDragging ? (dragging.dragOffsetY || 0) : 0;
                      const isDraggingThis = isActuallyDragged || isLinkedFollower || isAudioMirrorDragging;

                      const clipStyle = {
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `max(${widthPct}%, 30px)`,
                        height: `${rowH - 10}px`,
                        top: '5px',
                        transform: (dragOffset || dragOffsetY) ? `translate3d(${dragOffset}px, ${dragOffsetY}px, 0)` : undefined,
                        zIndex: isDraggingThis ? 200 : 10,
                        cursor: activeTool === 'trim' ? 'ew-resize' : (activeTool === 'blade' ? 'crosshair' : 'grab'),
                      };

                      if (isVideo) {
                        // Video clip block
                        return (
                          <div
                            key={clip.id}
                            className={`clip-block ${isClipSelected ? 'selected' : ''} ${activeTool === 'select' ? 'draggable' : ''}`}
                            style={clipStyle}
                            onPointerDown={(e) => {
                              if (activeTool === 'blade') {
                                handleBladeClick(e, clip.index);
                              } else if (clip.isLinkedAudioMirror) {
                                handleAudioMirrorPointerDown(e, clip);
                              } else {
                                handleClipPointerDown(e, clip.index);
                              }
                            }}
                            onPointerMove={(e) => {
                              if (clip.isLinkedAudioMirror && !isLinkingEnabled) {
                                handleAudioMirrorPointerMove(e, clip);
                              } else {
                                handleClipPointerMove(e, clip.index);
                              }
                            }}
                            onPointerUp={(e) => {
                              if (clip.isLinkedAudioMirror && !isLinkingEnabled) {
                                handleAudioMirrorPointerUp(e, clip);
                              } else {
                                handleClipPointerUp(e, clip.index);
                              }
                            }}
                            onMouseMove={(e) => handleBladeMouseMove(e, clip.index)}
                            onMouseLeave={handleBladeMouseLeave}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            title={`${clip.filename} — ${clip.effective.toFixed(1)}s [${trackDef.label}]`}
                          >
                            {/* Filmstrip thumbnails */}
                            {showThumbnails && (
                              frames.length > 0 ? (
                                <div className="clip-filmstrip">
                                  <div 
                                    className="filmstrip-inner"
                                    style={{
                                      width: `${(clip.duration / clip.effective) * 100}%`,
                                      left: `-${((clip.trimIn / 1000) / clip.effective) * 100}%`,
                                      position: 'absolute', top: 0, bottom: 0, display: 'flex'
                                    }}
                                  >
                                    {frames.map((f, idx) => (
                                      <div 
                                        key={idx} 
                                        className="filmstrip-frame"
                                        style={{
                                          backgroundImage: `url(${f.dataUrl})`,
                                          backgroundSize: 'cover',
                                          backgroundPosition: 'center',
                                          flex: 1,
                                          borderRight: '1px dashed rgba(255, 255, 255, 0.2)'
                                        }}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="clip-filmstrip">
                                  {Array.from({ length: Math.max(1, Math.floor(clip.effective / 3)) }).map((_, idx) => (
                                    <div key={idx} className="filmstrip-frame" />
                                  ))}
                                </div>
                              )
                            )}

                            {/* Trim handles */}
                            <div
                              className="trim-handle trim-handle-in"
                              onPointerDown={(e) => handleTrimDown(e, clip.index, 'trimIn')}
                            />

                            <div className="clip-block-label">
                              <span className="clip-block-name">{clip.filename}</span>
                              <span className="clip-block-dur">{clip.effective.toFixed(1)}s</span>
                            </div>

                            <button
                              className="clip-remove-btn"
                              onClick={(e) => { e.stopPropagation(); onRemoveClip?.(clip.id); }}
                              title="Remove clip"
                            >×</button>

                            <div
                              className="trim-handle trim-handle-out"
                              onPointerDown={(e) => handleTrimDown(e, clip.index, 'trimOut')}
                            />

                            {/* Blade cut preview red line */}
                            {activeTool === 'blade' && hoverCutPos && hoverCutPos.clipIndex === clip.index && (
                              <div className="blade-hover-line" style={{ left: `${hoverCutPos.pct * 100}%` }} />
                            )}
                          </div>
                        );
                      } else {
                        // Audio clip block
                        return (
                          <div
                            key={`audio-${clip.id}`}
                            className={`audio-clip-block ${isClipSelected ? 'selected' : ''} ${activeTool === 'select' ? 'draggable' : ''}`}
                            style={clipStyle}
                            onPointerDown={(e) => {
                              if (activeTool === 'blade') {
                                handleBladeClick(e, clip.index);
                              } else if (clip.isLinkedAudioMirror) {
                                handleAudioMirrorPointerDown(e, clip);
                              } else {
                                handleClipPointerDown(e, clip.index);
                              }
                            }}
                            onPointerMove={(e) => {
                              if (clip.isLinkedAudioMirror && !isLinkingEnabled) {
                                handleAudioMirrorPointerMove(e, clip);
                              } else {
                                handleClipPointerMove(e, clip.index);
                              }
                            }}
                            onPointerUp={(e) => {
                              if (clip.isLinkedAudioMirror && !isLinkingEnabled) {
                                handleAudioMirrorPointerUp(e, clip);
                              } else {
                                handleClipPointerUp(e, clip.index);
                              }
                            }}
                            onMouseMove={(e) => handleBladeMouseMove(e, clip.index)}
                            onMouseLeave={handleBladeMouseLeave}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClip(sourceClipId);
                            }}
                            title={`${clip.filename} - ${clip.effective.toFixed(1)}s [${trackDef.label}]`}
                          >
                            <div className="audio-clip-content">
                              <span className="audio-clip-title">{clip.filename}</span>
                              {showWaveforms && (
                                <div className="audio-waveform-canvas">
                                  {Array.from({ length: 24 }).map((_, idx) => {
                                    const h = Math.abs(Math.sin((idx + clip.index * 5) * 0.4)) * (compactTracks ? 8 : 12) + 2;
                                    return (
                                      <div key={idx} className="audio-wave-bar" style={{ height: `${h}px` }} />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {activeTool === 'blade' && hoverCutPos && hoverCutPos.clipIndex === clip.index && (
                              <div className="blade-hover-line" style={{ left: `${hoverCutPos.pct * 100}%` }} />
                            )}
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              );
            })}

            {/* Playhead spanning all track lanes */}
            {timelineClips.length > 0 && (
              <div 
                ref={playheadRef} 
                className="track-playhead" 
                style={{ left: playheadLeft }}
              >
                <div className="playhead-head" />
                <div className="playhead-line" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
