import React from 'react';

/**
 * NodeHeader — unified header bar for all React Flow nodes (P1-3)
 *
 * Standardizes the close button character (×) and layout across all
 * 8 node types. Supports optional style/labelStyle overrides for
 * MergeNode's custom gradient.
 */
export default function NodeHeader({ type, label, icon, onDelete, style, labelStyle, disabled, onToggleDisabled }) {
  return (
    <div className={`cf-node-header ${type || ''}`} style={style}>
      <h4 style={labelStyle}>{label}</h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} className="nodrag">
        {onToggleDisabled && (
          <label className="cf-node-switch" title={disabled ? "Enable node" : "Disable/Bypass node"}>
            <input 
              type="checkbox" 
              checked={!disabled} 
              onChange={(e) => onToggleDisabled(!e.target.checked)} 
            />
            <span className="cf-node-slider" />
          </label>
        )}
        <button className="nodrag close-btn" onClick={onDelete}>×</button>
      </div>
    </div>
  );
}
