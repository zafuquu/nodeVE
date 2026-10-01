/**
 * Shared math & time helpers for ClipForge (P2-1)
 */

/** Format seconds → "M:SS" */
export function formatSeconds(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

/** Format seconds → "HH:MM:SS.ff" timecode */
export function formatTimecode(s) {
  if (!s || !Number.isFinite(s)) return '0:00.00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Pixel position to percentage calculation */
export function calculatePercentagePosition(val, range) {
  if (range <= 0) return 50;
  const pct = (val / range) * 100;
  return Number(Math.max(0, Math.min(100, pct)).toFixed(1));
}

/** Format seconds → "HH:MM:SS:FF" frame-accurate technical timecode */
export function formatTechnicalTimecode(timeSec, fps = 60) {
  const totalFrames = Math.floor((timeSec || 0) * fps);
  const h = Math.floor(totalFrames / (3600 * fps));
  const m = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
  const s = Math.floor((totalFrames % (60 * fps)) / fps);
  const f = totalFrames % fps;
  
  return [
    h.toString().padStart(2, '0'),
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0'),
    f.toString().padStart(2, '0')
  ].join(':');
}
