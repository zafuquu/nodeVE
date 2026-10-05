const AUDIO_EXT_RE = /\.(mp3|wav|aac|m4a|flac|ogg|opus|aiff?|wma|webm)$/i;

export function asTimelineNumber(value, fallback = 0) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const next = Number(trimmed.replace(/s$/i, ''));
    return Number.isFinite(next) ? next : fallback;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function getClipTrackType(clip = {}) {
  const explicit = String(clip.trackType || clip.type || '').trim().toLowerCase();
  if (explicit === 'audio' || explicit === 'a') return 'audio';
  if (explicit === 'video' || explicit === 'v') return 'video';

  const mediaPath = String(clip.filepath || clip.filename || '').trim();
  const aspect = String(clip.aspect || '').trim().toLowerCase();
  return clip.isAudio || aspect === 'audio' || AUDIO_EXT_RE.test(mediaPath) ? 'audio' : 'video';
}

export function normalizeTrackIndex(value, fallback = 1) {
  const parsed = Math.trunc(asTimelineNumber(value, fallback));
  const safe = parsed > 0 ? parsed : fallback;
  return Math.max(1, Math.min(3, safe));
}

export function normalizeStartOffset(clip = {}) {
  const explicitMs = clip.startOffsetMs ?? clip.startOffsetMS;
  if (explicitMs != null) {
    return Math.max(0, asTimelineNumber(explicitMs, 0) / 1000);
  }

  const raw = clip.startOffset ?? clip.offset ?? 0;
  if (typeof raw === 'string' && raw.trim().toLowerCase().endsWith('ms')) {
    return Math.max(0, asTimelineNumber(raw.trim().slice(0, -2), 0) / 1000);
  }

  return Math.max(0, asTimelineNumber(raw, 0));
}

export function getClipEffectiveDurationSec(clip = {}) {
  const duration = Math.max(0, asTimelineNumber(clip.duration, 0));
  const trimIn = Math.max(0, asTimelineNumber(clip.trimIn, 0));
  const trimOut = Math.max(trimIn, asTimelineNumber(clip.trimOut, duration * 1000));
  return Math.max(0, (trimOut - trimIn) / 1000);
}

export function sanitizeTimelineClip(clip = {}, index = 0) {
  const duration = Math.max(0, asTimelineNumber(clip.duration, 0));
  const sourceDurationMs = Math.max(0, duration * 1000);
  const trimIn = Math.min(sourceDurationMs, Math.max(0, asTimelineNumber(clip.trimIn, 0)));
  let trimOut = asTimelineNumber(clip.trimOut, sourceDurationMs);

  if (sourceDurationMs > 0) {
    trimOut = Math.min(sourceDurationMs, Math.max(trimIn, trimOut));
  } else {
    trimOut = Math.max(trimIn, trimOut);
  }

  if (trimOut <= trimIn && sourceDurationMs > trimIn) {
    trimOut = sourceDurationMs;
  }

  return {
    ...clip,
    id: String(clip.id || `clip-${index}`),
    filename: String(clip.filename || clip.name || `Clip ${index + 1}`),
    filepath: String(clip.filepath || clip.path || ''),
    duration,
    width: asTimelineNumber(clip.width, 0),
    height: asTimelineNumber(clip.height, 0),
    fps: asTimelineNumber(clip.fps, 0),
    trimIn,
    trimOut,
    trackType: getClipTrackType(clip),
    trackIndex: normalizeTrackIndex(clip.trackIndex, 1),
    startOffset: normalizeStartOffset(clip),
  };
}
