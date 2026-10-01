import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Ellipse, Transformer, Image as KonvaImage } from 'react-konva';
import { useVideo } from '../context/VideoProvider';
import { MASK_CANVAS_W, MASK_CANVAS_H } from '../utils/graphLayers';
import { drawShapePath } from '../utils/canvas';

const TOOLS = [
  { id: 'select', icon: 'P', label: 'Select' },
  { id: 'rect', icon: 'R', label: 'Rectangle' },
  { id: 'ellipse', icon: 'O', label: 'Ellipse' },
  { id: 'undo', icon: 'Undo', label: 'Undo', action: true },
  { id: 'redo', icon: 'Redo', label: 'Redo', action: true },
  { id: 'delete', icon: 'Del', label: 'Delete', action: true },
  { id: 'move', icon: 'Move', label: 'Move' },
];

const SHAPE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#e84393'];

function getMaskBounds(shapes) {
  if (!shapes.length) return null;
  const x1 = Math.min(...shapes.map((s) => s.x));
  const y1 = Math.min(...shapes.map((s) => s.y));
  const x2 = Math.max(...shapes.map((s) => s.x + s.width));
  const y2 = Math.max(...shapes.map((s) => s.y + s.height));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}


function MaskPreviewCanvas({ videoEl, videoReady, subscribe, shapes, subtractMode, canvasW, canvasH, previewW, previewH }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const ctx = canvasRef.current.getContext('2d');

    const getFitRect = () => {
      const vw = videoEl?.videoWidth || canvasW;
      const vh = videoEl?.videoHeight || canvasH;
      const scale = Math.min(previewW / vw, previewH / vh);
      const w = vw * scale;
      const h = vh * scale;
      return {
        x: (previewW - w) / 2,
        y: (previewH - h) / 2,
        w,
        h,
        sx: w / canvasW,
        sy: h / canvasH,
      };
    };

    const addMaskPath = (fit) => {
      ctx.beginPath();
      shapes.forEach((shape) => {
        drawShapePath(
          ctx,
          {
            ...shape,
            x: fit.x / fit.sx + shape.x,
            y: fit.y / fit.sy + shape.y,
          },
          fit.sx,
          fit.sy
        );
      });
    };

    const strokeShapes = (fit, color) => {
      shapes.forEach((shape) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        drawShapePath(
          ctx,
          {
            ...shape,
            x: fit.x / fit.sx + shape.x,
            y: fit.y / fit.sy + shape.y,
          },
          fit.sx,
          fit.sy
        );
        ctx.stroke();
        ctx.setLineDash([]);
      });
    };

    const drawContainedVideo = (fit) => {
      if (videoEl && videoReady) {
        ctx.drawImage(videoEl, fit.x, fit.y, fit.w, fit.h);
      } else {
        ctx.fillStyle = '#222';
        ctx.fillRect(fit.x, fit.y, fit.w, fit.h);
      }
    };

    const draw = () => {
      const fit = getFitRect();
      ctx.clearRect(0, 0, previewW, previewH);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, previewW, previewH);

      if (!subtractMode) {
        if (shapes.length > 0) {
          ctx.save();
          addMaskPath(fit);
          ctx.clip();
          drawContainedVideo(fit);
          ctx.restore();
        }
        strokeShapes(fit, '#9b59b6');
      } else {
        drawContainedVideo(fit);
        ctx.save();
        addMaskPath(fit);
        ctx.clip();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, previewW, previewH);
        ctx.restore();

        ctx.globalCompositeOperation = 'source-over';
        strokeShapes(fit, '#e74c3c');
        ctx.fillStyle = 'rgba(231, 76, 60, 0.8)';
        ctx.fillRect(0, 0, previewW, 14);
        ctx.fillStyle = '#fff';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText('SUBTRACT MODE', 4, 10);
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    draw();
    if (!subscribe || !videoReady) return undefined;
    return subscribe(draw);
  }, [videoEl, videoReady, subscribe, shapes, subtractMode, canvasW, canvasH, previewW, previewH]);

  return (
    <canvas
      ref={canvasRef}
      width={previewW}
      height={previewH}
      style={{ width: '100%', height: 'auto', display: 'block', background: '#000' }}
    />
  );
}

const getRelativePointerPosition = (stage) => {
  const pointer = stage.getPointerPosition();
  if (!pointer) return null;
  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(pointer);
};

export default function MaskEditorModal({ isOpen, onClose, maskData, onSave }) {
  const { videoRef, videoReady, subscribe, isPlaying, togglePlay } = useVideo();
  const handlePlayClick = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTool, setActiveTool] = useState('rect');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [tempEnd, setTempEnd] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [shapeSettings, setShapeSettings] = useState({
    opacity: 1,
    feather: 0,
    roundness: 0,
    subtractMode: false,
  });

  // State for zoom & pan
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const imageRef = useRef(null);
  const trRef = useRef(null);
  const selectedRef = useRef(null);
  const stageRef = useRef(null);

  const canvasW = MASK_CANVAS_W;
  const canvasH = MASK_CANVAS_H;
  const previewW = 420;
  const previewH = 236;

  const pushHistory = (nextShapes) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIdx + 1);
      return [...trimmed, JSON.parse(JSON.stringify(nextShapes))];
    });
    setHistoryIdx((prev) => prev + 1);
  };

  useEffect(() => {
    if (!isOpen) return;
    const loaded = (maskData?.rects || []).map((rect, i) => ({
      ...rect,
      id: rect.id || `shape-${Date.now()}-${i}`,
      type: rect.type || 'rect',
      name: rect.name || `shape ${i + 1}`,
      color: rect.color || SHAPE_COLORS[i % SHAPE_COLORS.length],
      opacity: rect.opacity ?? 1,
      feather: rect.feather ?? 0,
      roundness: rect.roundness ?? 0,
    }));
    setShapes(loaded);
    setSelectedId(null);
    setHistory([JSON.parse(JSON.stringify(loaded))]);
    setHistoryIdx(0);
    setShapeSettings((prev) => ({
      ...prev,
      subtractMode: Boolean(maskData?.subtractMode ?? maskData?.invert ?? false),
    }));
    // Reset zoom and pan on open
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
  }, [isOpen, maskData]);

  useEffect(() => {
    if (!isOpen || !videoReady || !imageRef.current) return undefined;
    const layer = imageRef.current.getLayer();
    return subscribe(() => layer?.batchDraw());
  }, [isOpen, videoReady, subscribe]);

  useEffect(() => {
    if (selectedRef.current && trRef.current) {
      trRef.current.nodes([selectedRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedId, shapes]);

  const undo = () => {
    if (historyIdx <= 0) return;
    const nextIdx = historyIdx - 1;
    setHistoryIdx(nextIdx);
    setShapes(JSON.parse(JSON.stringify(history[nextIdx])));
    setSelectedId(null);
  };

  const redo = () => {
    if (historyIdx >= history.length - 1) return;
    const nextIdx = historyIdx + 1;
    setHistoryIdx(nextIdx);
    setShapes(JSON.parse(JSON.stringify(history[nextIdx])));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const nextShapes = shapes.filter((shape) => shape.id !== selectedId);
    setShapes(nextShapes);
    pushHistory(nextShapes);
    setSelectedId(null);
  };

  const handleToolClick = (tool) => {
    if (tool.id === 'undo') return undo();
    if (tool.id === 'redo') return redo();
    if (tool.id === 'delete') return deleteSelected();
    return setActiveTool(tool.id);
  };

  const handleStageMouseDown = (event) => {
    if (activeTool === 'select' || activeTool === 'move') {
      const clickedOnEmpty = event.target === event.target.getStage() || event.target.name() === 'video-bg';
      if (clickedOnEmpty) setSelectedId(null);
      return;
    }

    if (activeTool !== 'rect' && activeTool !== 'ellipse') return;
    const stage = event.target.getStage();
    const pos = getRelativePointerPosition(stage);
    if (!pos) return;
    setIsDrawing(true);
    setDrawStart(pos);
    setTempEnd(pos);
  };

  const handleStageMouseMove = (event) => {
    if (!isDrawing || !drawStart) return;
    const stage = event.target.getStage();
    const pos = getRelativePointerPosition(stage);
    if (pos) setTempEnd(pos);
  };

  const handleStageMouseUp = (event) => {
    if (!isDrawing || !drawStart) return;
    const stage = event.target.getStage();
    const pos = getRelativePointerPosition(stage);
    if (!pos) return;
    setIsDrawing(false);
    setTempEnd(null);

    const width = pos.x - drawStart.x;
    const height = pos.y - drawStart.y;
    if (Math.abs(width) < 5 || Math.abs(height) < 5) {
      setDrawStart(null);
      return;
    }

    const colorIdx = shapes.length % SHAPE_COLORS.length;
    const newShape = {
      id: `shape-${Date.now()}`,
      type: activeTool,
      name: `${activeTool} ${shapes.length + 1}`,
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      width: Math.abs(width),
      height: Math.abs(height),
      color: SHAPE_COLORS[colorIdx],
      opacity: shapeSettings.opacity,
      feather: shapeSettings.feather,
      roundness: shapeSettings.roundness,
    };

    const nextShapes = [...shapes, newShape];
    setShapes(nextShapes);
    pushHistory(nextShapes);
    setSelectedId(newShape.id);
    setDrawStart(null);
  };

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.5, Math.min(10, newScale));

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    setStageScale(clampedScale);
    setStagePos(newPos);
  };

  const handleStageDblClick = (e) => {
    if (activeTool === 'move') {
      setStageScale(1);
      setStagePos({ x: 0, y: 0 });
    }
  };

  const updateSelectedSetting = (key, value) => {
    setShapeSettings((prev) => ({ ...prev, [key]: value }));
    if (!selectedId) return;
    setShapes((prev) => prev.map((shape) => (
      shape.id === selectedId ? { ...shape, [key]: value } : shape
    )));
  };

  const handleTransformEnd = (id) => {
    const node = stageRef.current?.findOne(`#${id}`);
    if (!node) return;

    const nextShapes = shapes.map((shape) => {
      if (shape.id !== id) return shape;
      const nextWidth = Math.abs(shape.width * node.scaleX());
      const nextHeight = Math.abs(shape.height * node.scaleY());
      return {
        ...shape,
        x: shape.type === 'ellipse' ? node.x() - nextWidth / 2 : node.x(),
        y: shape.type === 'ellipse' ? node.y() - nextHeight / 2 : node.y(),
        width: nextWidth,
        height: nextHeight,
      };
    });

    node.scaleX(1);
    node.scaleY(1);
    setShapes(nextShapes);
    pushHistory(nextShapes);
  };

  const handleSave = () => {
    const rects = shapes.map((shape) => ({
      id: shape.id,
      type: shape.type,
      name: shape.name,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      color: shape.color,
      opacity: shape.opacity,
      feather: shape.feather,
      roundness: shape.roundness,
    }));
    const subtractMode = Boolean(shapeSettings.subtractMode);
    onSave({
      ...maskData,
      rects,
      maskBounds: getMaskBounds(rects),
      maskCanvas: { width: canvasW, height: canvasH },
      subtractMode,
      invert: subtractMode,
    });
    onClose();
  };

  if (!isOpen) return null;

  const selectedShape = shapes.find((shape) => shape.id === selectedId);
  const sharedVideo = videoRef.current;

  return (
    <div className="mask-editor-fullscreen">
      <div className="mask-editor-toolbar">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`mask-tool-btn ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => handleToolClick(tool)}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="mask-editor-main">
        <div className="mask-editor-topbar">
          <span className="mask-editor-badge">EDIT VIEW</span>
          <div style={{ flex: 1 }} />
          <span className="mask-editor-badge">MASK PREVIEW</span>
        </div>

        <div className="mask-editor-canvases">
          <div className="mask-editor-edit-pane">
            <Stage
              ref={stageRef}
              width={canvasW}
              height={canvasH}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePos.x}
              y={stagePos.y}
              draggable={activeTool === 'move'}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onWheel={handleWheel}
              onDblClick={handleStageDblClick}
              onDragEnd={(e) => {
                if (e.target === stageRef.current) {
                  setStagePos(e.target.position());
                }
              }}
              style={{ cursor: activeTool === 'rect' || activeTool === 'ellipse' ? 'crosshair' : activeTool === 'move' ? 'grab' : 'default' }}
            >
              <Layer>
                {videoReady && sharedVideo ? (
                  <KonvaImage
                    ref={imageRef}
                    image={sharedVideo}
                    x={0}
                    y={0}
                    width={canvasW}
                    height={canvasH}
                    name="video-bg"
                  />
                ) : (
                  <Rect x={0} y={0} width={canvasW} height={canvasH} fill="#1a1a2e" name="video-bg" />
                )}

                {shapes.map((shape) => {
                  const isSelected = shape.id === selectedId;
                  if (shape.type === 'ellipse') {
                    return (
                      <Ellipse
                        key={shape.id}
                        id={shape.id}
                        ref={isSelected ? selectedRef : undefined}
                        x={shape.x + shape.width / 2}
                        y={shape.y + shape.height / 2}
                        radiusX={shape.width / 2}
                        radiusY={shape.height / 2}
                        fill={`${shape.color}55`}
                        stroke={shape.color}
                        strokeWidth={isSelected ? 2 : 1}
                        opacity={shape.opacity}
                        shadowBlur={shape.feather || 0}
                        shadowColor={shape.color || 'black'}
                        shadowOpacity={shape.feather > 0 ? 0.6 : 0}
                        shadowForStrokeEnabled={false}
                        draggable={activeTool === 'select' || activeTool === 'move'}
                        onClick={() => setSelectedId(shape.id)}
                        onTap={() => setSelectedId(shape.id)}
                        onTransformEnd={() => handleTransformEnd(shape.id)}
                        onDragEnd={(event) => {
                          const nextShapes = shapes.map((item) => (
                            item.id === shape.id
                              ? { ...item, x: event.target.x() - item.width / 2, y: event.target.y() - item.height / 2 }
                              : item
                          ));
                          setShapes(nextShapes);
                          pushHistory(nextShapes);
                        }}
                      />
                    );
                  }

                  return (
                    <Rect
                      key={shape.id}
                      id={shape.id}
                      ref={isSelected ? selectedRef : undefined}
                      x={shape.x}
                      y={shape.y}
                      width={shape.width}
                      height={shape.height}
                      cornerRadius={shape.roundness || 0}
                      fill={`${shape.color}55`}
                      stroke={shape.color}
                      strokeWidth={isSelected ? 2 : 1}
                      opacity={shape.opacity}
                      shadowBlur={shape.feather || 0}
                      shadowColor={shape.color || 'black'}
                      shadowOpacity={shape.feather > 0 ? 0.6 : 0}
                      shadowForStrokeEnabled={false}
                      draggable={activeTool === 'select' || activeTool === 'move'}
                      onClick={() => setSelectedId(shape.id)}
                      onTap={() => setSelectedId(shape.id)}
                      onTransformEnd={() => handleTransformEnd(shape.id)}
                      onDragEnd={(event) => {
                        const nextShapes = shapes.map((item) => (
                          item.id === shape.id ? { ...item, x: event.target.x(), y: event.target.y() } : item
                        ));
                        setShapes(nextShapes);
                        pushHistory(nextShapes);
                      }}
                    />
                  );
                })}

                {isDrawing && drawStart && tempEnd && (
                  activeTool === 'ellipse' ? (
                    <Ellipse
                      x={(drawStart.x + tempEnd.x) / 2}
                      y={(drawStart.y + tempEnd.y) / 2}
                      radiusX={Math.abs(tempEnd.x - drawStart.x) / 2}
                      radiusY={Math.abs(tempEnd.y - drawStart.y) / 2}
                      fill="rgba(155, 89, 182, 0.3)"
                      stroke="#9b59b6"
                      strokeWidth={1}
                      dash={[4, 4]}
                    />
                  ) : (
                    <Rect
                      x={Math.min(drawStart.x, tempEnd.x)}
                      y={Math.min(drawStart.y, tempEnd.y)}
                      width={Math.abs(tempEnd.x - drawStart.x)}
                      height={Math.abs(tempEnd.y - drawStart.y)}
                      fill="rgba(155, 89, 182, 0.3)"
                      stroke="#9b59b6"
                      strokeWidth={1}
                      dash={[4, 4]}
                    />
                  )
                )}

                {selectedId && (
                  <Transformer
                    ref={trRef}
                    padding={3}
                    rotateEnabled={false}
                    enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']}
                    boundBoxFunc={(oldBox, newBox) => {
                      if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) return oldBox;
                      return newBox;
                    }}
                  />
                )}
              </Layer>
            </Stage>
          </div>

          <div className="mask-editor-preview-pane">
            <MaskPreviewCanvas
              videoEl={sharedVideo}
              videoReady={videoReady}
              subscribe={subscribe}
              shapes={shapes}
              subtractMode={shapeSettings.subtractMode}
              canvasW={canvasW}
              canvasH={canvasH}
              previewW={previewW}
              previewH={previewH}
            />
          </div>
        </div>

        <div className="mask-editor-timeline">
          <button
            className="mask-timeline-btn"
            onClick={handlePlayClick}
          >
            {videoRef.current ? (videoRef.current.paused ? 'Play' : 'Pause') : (isPlaying ? 'Pause' : 'Play')}
          </button>
          <div className="mask-timeline-track">
            <div className="mask-timeline-progress" />
          </div>
        </div>
      </div>

      <div className="mask-editor-sidebar">
        <div className="mask-sidebar-section">
          <h4 className="mask-sidebar-title">LAYERS</h4>
          <div className="mask-layers-list">
            {shapes.length === 0 && (
              <div style={{ fontSize: '11px', color: '#555a6e', padding: '8px' }}>No shapes yet</div>
            )}
            {shapes.map((shape) => (
              <div
                key={shape.id}
                className={`mask-layer-item ${shape.id === selectedId ? 'selected' : ''}`}
                onClick={() => setSelectedId(shape.id)}
              >
                <span className="layer-color-dot" style={{ background: shape.color }} />
                <span className="layer-name">{shape.name}</span>
                <button
                  className="layer-visibility-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShapes((prev) => prev.map((item) => (
                      item.id === shape.id ? { ...item, opacity: item.opacity > 0 ? 0 : 1 } : item
                    )));
                  }}
                >
                  {shape.opacity > 0 ? 'on' : 'off'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mask-sidebar-section">
          <h4 className="mask-sidebar-title">SHAPE SETTINGS</h4>
          {selectedShape ? (
            <div className="mask-settings-content">
              <div className="mask-setting-row">
                <label>Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selectedShape.opacity}
                  onChange={(event) => updateSelectedSetting('opacity', Number(event.target.value))}
                />
                <span>{Math.round((selectedShape.opacity || 1) * 100)}%</span>
              </div>
              <div className="mask-setting-row">
                <label>Feather</label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={selectedShape.feather || 0}
                  onChange={(event) => updateSelectedSetting('feather', Number(event.target.value))}
                />
                <span>{selectedShape.feather || 0}</span>
              </div>
              <div className="mask-setting-row">
                <label>Roundness</label>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={selectedShape.roundness || 0}
                  onChange={(event) => updateSelectedSetting('roundness', Number(event.target.value))}
                />
                <span>{selectedShape.roundness || 0}</span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: '#555a6e', padding: '8px' }}>No item selected</div>
          )}
          <label className="mask-setting-checkbox">
            <input
              type="checkbox"
              checked={shapeSettings.subtractMode}
              onChange={(event) => setShapeSettings((prev) => ({ ...prev, subtractMode: event.target.checked }))}
            />
            Subtract Mode
          </label>
        </div>

        <div className="mask-sidebar-actions">
          <button className="mask-action-btn discard" onClick={onClose}>Discard</button>
          <button className="mask-action-btn save" onClick={handleSave}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}
