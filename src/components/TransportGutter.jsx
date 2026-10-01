import React from 'react';
import { useVideo } from '../context/VideoProvider';
import { formatTechnicalTimecode } from '../utils/helpers';

/**
 * TransportGutter component placed in the dividing line between the preview
 * panels and the bottom timeline track array.
 */
export default function TransportGutter() {
  const { currentTime, duration, isPlaying, seek, togglePlay } = useVideo();

  const handleJumpStart = () => seek(0);
  const handleJumpEnd = () => seek(duration);
  const handleStepBack = () => seek(Math.max(0, currentTime - 1 / 60));
  const handleStepForward = () => seek(Math.min(duration, currentTime + 1 / 60));

  return (
    <div className="transport-gutter">
      <div className="transport-controls">
        <button className="transport-btn" onClick={handleJumpStart} title="Jump to Start">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="2" width="2" height="8" fill="currentColor" />
            <polygon points="11,2 5,6 11,10" fill="currentColor" />
          </svg>
        </button>
        <button className="transport-btn" onClick={handleStepBack} title="Step Back 1 Frame">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="10,2 4,6 10,10" fill="currentColor" />
          </svg>
        </button>
        <button
          className={`transport-btn transport-play ${isPlaying ? 'active' : ''}`}
          onClick={togglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14">
              <rect x="2" y="2" width="3.5" height="10" fill="currentColor" />
              <rect x="8.5" y="2" width="3.5" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14">
              <polygon points="3,1 13,7 3,13" fill="currentColor" />
            </svg>
          )}
        </button>
        <button className="transport-btn" onClick={handleStepForward} title="Step Forward 1 Frame">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="2,2 8,6 2,10" fill="currentColor" />
          </svg>
        </button>
        <button className="transport-btn" onClick={handleJumpEnd} title="Jump to End">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="1,2 7,6 1,10" fill="currentColor" />
            <rect x="9" y="2" width="2" height="8" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="timecode-display" style={{ fontFamily: 'var(--font-mono)' }}>
        {formatTechnicalTimecode(currentTime)}
      </div>

      <span className="transport-duration" style={{ fontFamily: 'var(--font-mono)' }}>
        / {formatTechnicalTimecode(duration)}
      </span>
    </div>
  );
}
