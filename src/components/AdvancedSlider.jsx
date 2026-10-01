import React, { useState, useRef, useEffect } from 'react';

/**
 * AdvancedSlider — unified slider with:
 *  - Double-click to reset to default value
 *  - Click on numeric readout to type an exact value
 *  - Consistent styling across all nodes
 */
export default function AdvancedSlider({
  label, value, min = 0, max = 100, step = 1,
  defaultValue, onChange, suffix = '', disabled = false,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e) => {
    e.preventDefault();
    if (defaultValue !== undefined) onChange(defaultValue);
  };

  const handleValueClick = () => {
    setEditValue(String(value));
    setIsEditing(true);
  };

  const handleEditSubmit = () => {
    const num = Number(editValue);
    if (Number.isFinite(num)) {
      onChange(Math.max(min, Math.min(max, num)));
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleEditSubmit();
    if (e.key === 'Escape') setIsEditing(false);
    e.stopPropagation(); // Prevent keyboard shortcuts from firing
  };

  return (
    <div className="cf-slider-row">
      <span className="cf-slider-label">{label}</span>
      <input
        type="range"
        className="cf-slider nodrag"
        min={min} max={max} step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={handleDoubleClick}
        title={defaultValue !== undefined ? `Double-click to reset to ${defaultValue}${suffix}` : undefined}
        style={disabled ? { opacity: 0.5 } : undefined}
      />
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          className="cf-slider-edit nodrag"
          value={editValue}
          min={min} max={max} step={step}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleEditSubmit}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      ) : (
        <span
          className="cf-slider-value"
          onClick={handleValueClick}
          title="Click to type exact value"
          style={{ cursor: 'pointer' }}
        >
          {value}{suffix}
        </span>
      )}
    </div>
  );
}
