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

  // ── Timeline duration across all video tracks ────────────
  // V1 is the base program, but V2/V3 overlays can extend beyond it.
  const sourceDuration = useMemo(() => {
    const videoClips = sanitizedTimelineClips.filter(
      c => c.trackType === 'video' && [1, 2, 3].includes(Number(c.trackIndex))
    );

    return videoClips.reduce((max, c) => {
      const eff = getClipEffectiveDurationSec(c);
      return Math.max(max, (c.startOffset ?? 0) + eff);
    }, 0);
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

  // ── Add clip after the last clip on its own track ────────
  const addClipToTimeline = useCallback((newClip) => {
    const normalizedNewClip = sanitizeTimelineClip(newClip, timelineClips.length);
    setTimelineClips(prev => {
      const normalizedPrev = prev.map((clip, index) => sanitizeTimelineClip(clip, index));
      const targetType = normalizedNewClip.trackType;
      const targetTrack = Number(normalizedNewClip.trackIndex);
      const sameTrack = normalizedPrev.filter(
        c => c.trackType === targetType && Number(c.trackIndex) === targetTrack
      );
      const lastEnd = sameTrack.reduce((max, c) => {
        const eff = getClipEffectiveDurationSec(c);
        return Math.max(max, (c.startOffset ?? 0) + eff);
      }, 0);
      return [...prev, { ...normalizedNewClip, startOffset: lastEnd }];
    });
  }, [timelineClips.length]);

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
        const sameTrack =
          c.trackType === oldClip.trackType &&
          Number(c.trackIndex) === Number(oldClip.trackIndex);
        const oldStart = c.startOffset ?? 0;
        if (sameTrack && oldStart >= (oldClip.startOffset ?? 0) + oldEff) {
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