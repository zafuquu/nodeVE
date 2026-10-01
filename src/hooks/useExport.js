import { useState, useCallback, useRef } from 'react';
import { sanitizeTimelineClip } from '../utils/timelineClips';

function asNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function sanitizeLayerObject(layer) {
  const copyBounds = (bounds) => bounds ? {
    x: asNumber(bounds.x),
    y: asNumber(bounds.y),
    w: asNumber(bounds.w ?? bounds.width),
    h: asNumber(bounds.h ?? bounds.height),
    width: asNumber(bounds.width ?? bounds.w),
    height: asNumber(bounds.height ?? bounds.h),
  } : null;

  const copyShape = (shape, index) => ({
    id: String(shape.id || `shape-${index}`),
    type: String(shape.type || 'rect'),
    x: asNumber(shape.x),
    y: asNumber(shape.y),
    w: asNumber(shape.w ?? shape.width),
    h: asNumber(shape.h ?? shape.height),
    opacity: asNumber(shape.opacity, 1),
    feather: asNumber(shape.feather),
    roundness: asNumber(shape.roundness),
  });

  return {
    id: String(layer.id || ''),
    order: asNumber(layer.order),
    mergeNodeId: String(layer.mergeNodeId || ''),
    inputHandle: layer.inputHandle == null ? null : String(layer.inputHandle),
    sourceNodeId: String(layer.sourceNodeId || ''),
    cropNodeId: layer.cropNodeId == null ? null : String(layer.cropNodeId),
    maskNodeId: layer.maskNodeId == null ? null : String(layer.maskNodeId),
    transformNodeId: String(layer.transformNodeId || ''),
    source: {
      width: asNumber(layer.source?.width, 1920),
      height: asNumber(layer.source?.height, 1080),
      filepath: String(layer.source?.filepath || ''),
    },
    cropBounds: copyBounds(layer.cropBounds),
    sourceBounds: copyBounds(layer.sourceBounds),
    maskBounds: copyBounds(layer.maskBounds),
    maskRects: (layer.maskRects || []).map(copyShape),
    localMaskRects: (layer.localMaskRects || []).map(copyShape),
    subtractMode: Boolean(layer.subtractMode),
    blurRadius: asNumber(layer.blurRadius),
    feather: asNumber(layer.feather),
    transformPos: {
      x: asNumber(layer.transformPos?.x, 50),
      y: asNumber(layer.transformPos?.y, 50),
    },
    transformScale: {
      x: asNumber(layer.transformScale?.x, 100),
      y: asNumber(layer.transformScale?.y, 100),
    },
    transform: {
      scaleX: asNumber(layer.transform?.scaleX, 100),
      scaleY: asNumber(layer.transform?.scaleY, 100),
      posX: asNumber(layer.transform?.posX, 50),
      posY: asNumber(layer.transform?.posY, 50),
      rotation: asNumber(layer.transform?.rotation),
    },
  };
}

function sanitizeNodeData(node) {
  const data = node.data || {};
  switch (node.type) {
    case 'source':
      return {
        label: 'SOURCE',
        filename: String(data.filename || ''),
        filepath: String(data.filepath || ''),
        duration: asNumber(data.duration),
        width: asNumber(data.width, 1920),
        height: asNumber(data.height, 1080),
        fps: asNumber(data.fps, 60),
        aspect: String(data.aspect || '16:9'),
        scaleX: asNumber(data.scaleX, 100),
        scaleY: asNumber(data.scaleY, 100),
        posX: asNumber(data.posX, 50),
        posY: asNumber(data.posY, 50),
        lockAspect: data.lockAspect !== false,
      };
    case 'crop':
      return { label: 'CROP', top: asNumber(data.top), bottom: asNumber(data.bottom), left: asNumber(data.left), right: asNumber(data.right) };
    case 'mask':
      return {
        label: 'MASK',
        shape: String(data.shape || 'rectangle'),
        feather: asNumber(data.feather),
        invert: Boolean(data.invert),
        subtractMode: Boolean(data.subtractMode ?? data.invert),
        maskBounds: data.maskBounds ? { x: asNumber(data.maskBounds.x), y: asNumber(data.maskBounds.y), w: asNumber(data.maskBounds.w ?? data.maskBounds.width), h: asNumber(data.maskBounds.h ?? data.maskBounds.height) } : null,
        maskCanvas: { width: asNumber(data.maskCanvas?.width, 640), height: asNumber(data.maskCanvas?.height, 360) },
        rects: (data.rects || []).map((rect, index) => ({ id: String(rect.id || `rect-${index}`), type: String(rect.type || 'rect'), name: String(rect.name || `rect ${index + 1}`), x: asNumber(rect.x), y: asNumber(rect.y), width: asNumber(rect.width), height: asNumber(rect.height), opacity: asNumber(rect.opacity, 1), feather: asNumber(rect.feather), roundness: asNumber(rect.roundness) })),
      };
    case 'transform':
      return { label: 'TRANSFORM+', scaleX: asNumber(data.scaleX, 100), scaleY: asNumber(data.scaleY, 100), posX: asNumber(data.posX, 50), posY: asNumber(data.posY, 50), rotation: asNumber(data.rotation), lockAspect: data.lockAspect !== false };
    case 'blur':
      return { label: 'BLUR', radius: asNumber(data.radius, 20), stretch: data.stretch !== false };
    case 'concat':
      return { label: String(data.label || 'CONCAT SEQUENCE') };
    case 'audio':
      return { label: String(data.label || 'BACKGROUND MUSIC'), filename: String(data.filename || ''), filepath: String(data.filepath || ''), volume: asNumber(data.volume, 50), offset: asNumber(data.offset, 0), duration: asNumber(data.duration, 0) };
    default:
      return { label: String(data.label || node.type?.toUpperCase?.() || '') };
  }
}

function sanitizeGraphData({ nodes, edges, layerObjects, settings, trim, sourceNode, outputPath, gpuAvailable, clips }) {
  const sanitized = {
    inputPath: String(sourceNode.data.filepath || ''),
    outputPath: String(outputPath || ''),
    duration: asNumber(sourceNode.data.duration),
    clips: (clips || []).map((c, index) => sanitizeTimelineClip(c, index)),
    nodes: (nodes || []).map((node) => ({
      id: String(node.id || ''),
      type: String(node.type || ''),
      position: { x: asNumber(node.position?.x), y: asNumber(node.position?.y) },
      data: sanitizeNodeData(node),
    })),
    edges: (edges || []).map((edge) => ({
      id: String(edge.id || ''),
      source: String(edge.source || ''),
      target: String(edge.target || ''),
      sourceHandle: edge.sourceHandle == null ? null : String(edge.sourceHandle),
      targetHandle: edge.targetHandle == null ? null : String(edge.targetHandle),
    })),
    layerObjects: (layerObjects || []).map(sanitizeLayerObject),
    gpuAvailable: Boolean(gpuAvailable),
    settings: {
      codec: String(settings.codec || ''),
      bitrate: String(settings.bitrate || '20M'),
      fps: asNumber(settings.fps, 60),
      targetPlatform: String(settings.targetPlatform || 'tiktok'),
    },
    trim: { in: asNumber(trim.in), out: asNumber(trim.out, 100) },
  };
  return JSON.parse(JSON.stringify(sanitized));
}

/**
 * Custom hook for handling video export via Electron IPC.
 */
export function useExport() {
  const [isExportModalOpen, setExportModalOpen] = useState(false);
  const exportInProgressRef = useRef(false);

  const handleExport = useCallback(async (settings, nodes, edges, gpuInfo, sourceNode, resolvedLayers, sanitizedTimelineClips, trimIn, trimOut, updateNodeData) => {
    if (!window.clipForge) {
      alert(`Export mock triggered.\nCodec: ${settings.codec}\nBitrate: ${settings.bitrate}\nTrim: ${trimIn}% - ${trimOut}%`);
      return;
    }

    if (!sourceNode) {
      alert('Please load a video file in a SOURCE node first.');
      return;
    }

    if (exportInProgressRef.current) {
      alert('An export is already in progress.');
      return;
    }

    const originalFilepath = sourceNode.data.filepath;
    const outputPath = await window.clipForge.saveFile();
    if (!outputPath) return;

    exportInProgressRef.current = true;

    try {
      const layers = resolvedLayers?.length > 0
        ? resolvedLayers
        : (() => {
            const { resolveOutputLayers } = require('../utils/graphLayers');
            const { layers } = resolveOutputLayers(nodes, edges, null, {
              srcW: sourceNode.data.width || 1920,
              srcH: sourceNode.data.height || 1080,
            });
            return layers;
          })();

      const exportPayload = sanitizeGraphData({
        nodes,
        edges,
        layerObjects: layers,
        sourceNode,
        outputPath,
        gpuAvailable: gpuInfo.available,
        settings,
        trim: { in: trimIn, out: trimOut },
        clips: sanitizedTimelineClips,
      });

      const result = await window.clipForge.exportVideo(exportPayload);

      if (result.success) {
        alert('Export complete!');
      } else {
        alert(`Export failed: ${result.error}`);
      }
    } catch (err) {
      console.error('[Export] Error during export:', err);
      alert(`Export failed: ${err.message || err}`);
    } finally {
      exportInProgressRef.current = false;
      if (sourceNode.data.filepath !== originalFilepath) {
        console.warn('[Export] Filepath mutated during export. Restoring original path.');
        updateNodeData(sourceNode.id, { filepath: originalFilepath });
      }
    }
  }, []);

  return {
    isExportModalOpen,
    setExportModalOpen,
    handleExport,
  };
}