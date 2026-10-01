import { useState, useCallback, useMemo } from 'react';
import { sanitizeTimelineClip, getClipEffectiveDurationSec } from '../utils/timelineClips';

/**
 * Custom hook for managing timeline clips state.
 * Handles clip CRUD, trim changes, track assignments, and start offsets.
 */
export function useTimelineData() {
  const [timelineClips, setTimelineClips] = useState([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);

  const sanitizedTimelineClips = useMemo(() => {
    return timelineClips.map((clip, index) => sanitizeTimelineClip(clip, index));
  }, [timelineClips]);

  // ── V1 video clips for VideoProvider playback ────────────
  const outputClips = useMemo(() => {
    return sanitizedTimelineClips
      .map((clip, sourceIndex) => ({ ...clip, sourceIndex }))
      .filter(c => c.trackType === 'video' && Number(c.trackIndex) === 1)
      .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  }, [sanitizedTimelineClips]);

  // ── Source duration from clips ───────────────────────────
  const sourceDuration = useMemo(() => {
    if (sanitizedTimelineClips.length > 0) {
      return sanitizedTimelineClips.reduce((max, c) => {
        const eff = getClipEffectiveDurationSec(c);
        return Math.max(max, (c.startOffset ?? 0) + eff);
      }, 0);
    }
    return 120;
  }, [sanitizedTimelineClips]);

  // ── Active clip info ─────────────────────────────────────
  const activeClip = sanitizedTimelineClips[activeClipIndex] || null;

  // ── Handlers ─────────────────────────────────────────────
  const handleRemoveClip = useCallback((clipId) => {
    setTimelineClips(prev => prev.filter(c => c.id !== clipId));
    setActiveClipIndex(0);
  }, []);

  const handleClipTrimChange = useCallback((clipId, trimIn, trimOut) => {
    setTimelineClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, trimIn, trimOut } : c
    ));
  }, []);

  const handleClipTrackChange = useCallback((clipId, trackType, trackIndex) => {
    setTimelineClips(prev => prev.map((c, index) =>
      c.id === clipId ? sanitizeTimelineClip({ ...c, trackType, trackIndex }, index) : c
    ));
  }, []);

  const handleClipStartOffsetChange = useCallback((clipId, startOffset) => {
    setTimelineClips(prev => prev.map((c, index) =>
      c.id === clipId ? sanitizeTimelineClip({ ...c, startOffset }, index) : c
    ));
  }, []);

  // ── Add clip with auto-offset after last V1 clip ─────────
  const addClipToTimeline = useCallback((newClip) => {
    const normalizedNewClip = sanitizeTimelineClip(newClip, timelineClips.length);
    setTimelineClips(prev => {
      const normalizedPrev = prev.map((clip, index) => sanitizeTimelineClip(clip, index));
      const v1clips = normalizedPrev.filter(c => c.trackType === 'video' && Number(c.trackIndex) === 1);
      const lastEnd = v1clips.reduce((max, c) => {
        const eff = getClipEffectiveDurationSec(c);
        return Math.max(max, (c.startOffset ?? 0) + eff);
      }, 0);
      return [...prev, { ...normalizedNewClip, startOffset: lastEnd }];
    });
  }, []);

  // ── Ripple edit: when trimming left edge, shift following clips ──
  const handleRippleTrimChange = useCallback((clipId, trimIn, trimOut) => {
    setTimelineClips(prev => {
      const clips = prev.map((c, index) => sanitizeTimelineClip(c, index));
      const targetIndex = clips.findIndex(c => c.id === clipId);
      if (targetIndex === -1) return prev;

      const oldClip = clips[targetIndex];
      const oldEff = getClipEffectiveDurationSec(oldClip);
      const delta = (trimOut - trimIn) / 1000 - oldEff;

      return prev.map((c, index) => {
        if (c.id === clipId) return { ...c, trimIn, trimOut };
        if (index > targetIndex && Number(c.trackIndex) === 1 && c.trackType === 'video') {
          const oldStart = c.startOffset ?? 0;
          return { ...c, startOffset: Math.max(0, oldStart + delta) };
        }
        return c;
      });
    });
  }, []);

  return {
    timelineClips,
    setTimelineClips,
    activeClipIndex,
    setActiveClipIndex,
    sanitizedTimelineClips,
    outputClips,
    sourceDuration,
    activeClip,
    handleRemoveClip,
    handleClipTrimChange,
    handleClipTrackChange,
    handleClipStartOffsetChange,
    addClipToTimeline,
    handleRippleTrimChange,
  };
}