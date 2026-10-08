import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Image, Shape } from 'react-konva';
import Konva from 'konva';
import { useVideo } from '../context/VideoProvider';
import { resolveOutputLayers } from '../utils/graphLayers';
import { applyLayerClipPath, computeLayerGeometry } from '../utils/canvasCompositor';
import { calculatePercentagePosition } from '../utils/helpers';

export default function PreviewPanel({ nodes, edges, updateNodeData, globalAspect }) {
  const { videoRef, timelineVideoRefs, videoReady, srcW, srcH, subscribe, currentTime, duration, isPlaying, togglePlay, seek } = useVideo();
  const layerRef = useRef(null);
  const wrapperRef = useRef(null);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 300, height: 400 });

  const handlePlayClick = () => togglePlay();

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const targetRes = useMemo(() => {
    switch (globalAspect) {
      case '9:16': return { w: 1080, h: 1920 };
      case '4:3': return { w: 1440, h: 1080 };
      case '1:1': return { w: 1080, h: 1080 };
      default: return { w: 1080, h: 1920 };
    }
  }, [globalAspect]);

  const { canvasW, canvasH, scale } = useMemo(() => {
    const targetW = targetRes.w || 1080;
    const targetH = targetRes.h || 1920;
    const scaleFactor = Math.min(dimensions.width / targetW, dimensions.height / targetH);
    const w = Math.round(targetW * scaleFactor);
    const h = Math.round(targetH * scaleFactor);
    return { canvasW: w, canvasH: h, scale: scaleFactor };
  }, [dimensions, targetRes]);

  // Serialize only operational node data (not positions) so layer resolution
  // is completely silent while nodes are dragged/panned around the workspace.
  const nodeDataSerialized = useMemo(() =>
    JSON.stringify(nodes.map(n => ({ id: n.id, type: n.type, data: n.data }))),
  [nodes]);

  const edgeConnSerialized = useMemo(() =>
    edges.map(e => `${e.source}:${e.sourceHandle}>${e.target}:${e.targetHandle}`).join('|'),
  [edges]);

  const { mergeNode, layers } = useMemo(() => {
    return resolveOutputLayers(nodes, edges, null, { srcW, srcH });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDataSerialized, edgeConnSerialized, srcW, srcH]);

  const sourceNode = useMemo(() => nodes.find((node) => node.type === 'source' && node.data.filepath), [nodes]);
  const bgAspect = srcW / srcH;
  const bgH = canvasH;
  const bgW = bgAspect * canvasH;
  const bgX = (canvasW - bgW) / 2;

  useEffect(() => {
    return subscribe(() => {
      if (layerRef.current) {
        layerRef.current.batchDraw();
      }
    });
  }, [videoReady, subscribe]);

  const handleLayerDrag = useCallback((layerObject, e) => {
    const geo = computeLayerGeometry(layerObject, canvasW, canvasH);
    const rangeX = canvasW - geo.w;
    const rangeY = canvasH - geo.h;
    const posX = calculatePercentagePosition(e.target.x(), rangeX);
    const posY = calculatePercentagePosition(e.target.y(), rangeY);
    updateNodeData(layerObject.transformNodeId, {
      posX,
      posY,
    });
  }, [canvasW, canvasH, updateNodeData]);

  const handleLayerDragEnd = useCallback((layerObject, e) => {
    const geo = computeLayerGeometry(layerObject, canvasW, canvasH);
    const rangeX = canvasW - geo.w;
    const rangeY = canvasH - geo.h;
    const posX = calculatePercentagePosition(e.target.x(), rangeX);
    const posY = calculatePercentagePosition(e.target.y(), rangeY);
    
    updateNodeData(layerObject.transformNodeId, {
      posX,
      posY,
    });
  }, [canvasW, canvasH, updateNodeData]);


  const resLabel = globalAspect === '1:1' ? '1080x1080' : globalAspect === '4:3' ? '1440x1080' : '1080x1920';

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <h3>OUTPUT</h3>
        <span className="preview-resolution">{mergeNode ? `${resLabel} / ${layers.length} layers` : resLabel}</span>
      </div>

      <div className="preview-canvas-wrapper" ref={wrapperRef}>
        <div className="preview-canvas" style={{ background: '#141414', width: canvasW, height: canvasH }}>
          <Stage width={canvasW} height={canvasH} onClick={() => setSelectedLayerId(null)} pixelRatio={1}>
            <Layer ref={layerRef}>
              <Rect width={canvasW} height={canvasH} fill="#141414" />

              {videoReady && videoRef.current && (
                <Image
                  image={videoRef.current}
                  x={bgX}
                  y={0}
                  width={bgW}
                  height={bgH}
                />
              )}

              {[3, 2].map((track) => {
                const trackVideo = timelineVideoRefs?.current?.get(track);
                if (!trackVideo || trackVideo.readyState < 2) return null;
                return (
                  <Image
                    key={`timeline-track-${track}`}
                    image={trackVideo}
                    x={0}
                    y={0}
                    width={canvasW}
                    height={canvasH}
                  />
                );
              })}

              {[1, 2].map((i) => (
                <React.Fragment key={`grid-${i}`}>
                  <Line points={[0, (canvasH / 3) * i, canvasW, (canvasH / 3) * i]} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
                  <Line points={[(canvasW / 3) * i, 0, (canvasW / 3) * i, canvasH]} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
                </React.Fragment>
              ))}

              {!sourceNode && (
                <>
                  <Text text="[ ]" x={canvasW / 2 - 10} y={canvasH / 2 - 24} fontSize={16} fill="rgba(255,255,255,0.12)" fontFamily="JetBrains Mono" />
                  <Text text="Add a SOURCE node" x={canvasW / 2 - 52} y={canvasH / 2 + 4} fill="rgba(255,255,255,0.15)" fontSize={11} fontFamily="Inter" />
                  <Text text="and load a video to begin" x={canvasW / 2 - 65} y={canvasH / 2 + 20} fill="rgba(255,255,255,0.08)" fontSize={10} fontFamily="Inter" />
                </>
              )}

              {videoReady && videoRef.current && layers && layers.map((layerObject, idx) => {
                if (!layerObject) return null;
                const geo = computeLayerGeometry(layerObject, canvasW, canvasH);
                if (!geo) return null;
                const isSelected = selectedLayerId === layerObject.transformNodeId;
                const sourceBounds = layerObject.sourceBounds || { x: 0, y: 0, w: srcW, h: srcH };
                if (sourceBounds.w <= 0 || sourceBounds.h <= 0) return null;

                // Use Konva's native crop: extract sourceBounds region from the
                // video and scale it to geo.w × geo.h. This avoids the stretching
                // bug caused by drawing the full video and clipping.
                const konvaCrop = {
                  x: sourceBounds.x,
                  y: sourceBounds.y,
                  width: sourceBounds.w,
                  height: sourceBounds.h,
                };

                // Only apply clipFunc when mask shapes are present
                const hasMaskClip = (layerObject.localMaskRects && layerObject.localMaskRects.length > 0)
                  || layerObject.subtractMode;

                return (
                  <Group
                    key={layerObject.id}
                    x={geo.x}
                    y={geo.y}
                    rotation={geo.rotation}
                    draggable={true}
                    clipFunc={hasMaskClip ? (ctx) => {
                      applyLayerClipPath(ctx, layerObject, geo.w, geo.h);
                    } : undefined}
                    onDragStart={(e) => {
                      setSelectedLayerId(layerObject.transformNodeId);
                    }}
                    onDragMove={(e) => handleLayerDrag(layerObject, e)}
                    onDragEnd={(e) => handleLayerDragEnd(layerObject, e)}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      setSelectedLayerId(layerObject.transformNodeId);
                    }}
                  >
                    <Shape
                      width={geo.w}
                      height={geo.h}
                      sceneFunc={(context, shape) => {
                        const ctx = context._context;
                        const video = videoRef.current;
                        if (!video) return;

                        ctx.save();
                        if (layerObject.blurRadius > 0) {
                          ctx.filter = `blur(${layerObject.blurRadius}px)`;
                        } else {
                          ctx.filter = 'none';
                        }
                        
                        ctx.drawImage(
                          video,
                          konvaCrop.x,
                          konvaCrop.y,
                          konvaCrop.width,
                          konvaCrop.height,
                          0,
                          0,
                          geo.w,
                          geo.h
                        );
                        ctx.restore();
                      }}
                    />
                    <Rect
                      x={0}
                      y={0}
                      width={geo.w}
                      height={geo.h}
                      fill="transparent"
                      stroke={isSelected ? 'var(--color-accent)' : 'rgba(255,255,255,0.25)'}
                      strokeWidth={isSelected ? 2 : 0.5}
                      dash={isSelected ? undefined : [4, 3]}
                    />
                    <Rect x={0} y={0} width={geo.w} height={12} fill="rgba(0,0,0,0.6)" />
                    <Text text={`L${idx + 1}`} x={3} y={1} fill={isSelected ? 'var(--color-accent)' : '#888'} fontSize={8} fontFamily="JetBrains Mono" />
                  </Group>
                );
              })}

              <Rect x={0} y={0} width={canvasW} height={canvasH} fill="transparent" stroke="rgba(200, 0, 0, 0.3)" strokeWidth={1} />
            </Layer>
          </Stage>
        </div>
      </div>
    </div>
  );
}
