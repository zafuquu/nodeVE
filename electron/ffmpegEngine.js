const { execSync, spawn } = require('child_process');
const fs = require('fs');

const OUTPUT_W = 1080;
const OUTPUT_H = 1920;
const OUTPUT_FPS = 60;
const MASK_CANVAS_W = 640;
const MASK_CANVAS_H = 360;

// Lazy ffmpeg path resolution — only runs once on first use (not at module load)
let _ffmpegPath = null;
let _ffmpegResolved = false;

function resolveFFmpeg() {
  if (_ffmpegResolved) return _ffmpegPath;
  _ffmpegResolved = true;

  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { windowsHide: true, timeout: 3000, stdio: 'ignore' });
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
  } catch {}

  const paths = [
    'C:\\Program Files\\Shutter Encoder\\Library\\ffmpeg.exe',
    'C:\\Program Files (x86)\\YouTube Playlist Downloader\\ffmpeg.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      _ffmpegPath = p;
      return _ffmpegPath;
    }
  }
  _ffmpegPath = 'ffmpeg';
  return _ffmpegPath;
}

function getFFmpegPath() {
  return resolveFFmpeg();
}

let _gpuResult = null;
let _gpuResolved = false;

function detectNvidiaGpu() {
  if (_gpuResolved) return _gpuResult;
  try {
    const { execSync } = require('child_process');
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const gpuName = output.trim().split('\n')[0].trim();
    _gpuResult = { available: true, gpuName };
  } catch {
    _gpuResult = { available: false, gpuName: null };
  }
  _gpuResolved = true;
  return _gpuResult;
}

function buildAdjacency(edges) {
  const reverse = new Map();
  for (const edge of edges || []) {
    if (!reverse.has(edge.target)) reverse.set(edge.target, []);
    reverse.get(edge.target).push(edge);
  }
  return { reverse };
}

function byId(nodes) {
  return new Map((nodes || []).map((node) => [node.id, node]));
}

function traceChainBackward(startNodeId, nodes, reverse) {
  const map = byId(nodes);
  const chain = [];
  const visited = new Set();
  let current = startNodeId;

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = map.get(current);
    if (node) chain.unshift(node);
    const parents = reverse.get(current) || [];
    current = parents[0]?.source || null;
  }

  return chain;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCropBounds(cropNode, srcW, srcH) {
  const data = cropNode?.data || {};
  const left = clamp(Number(data.left || 0), 0, 99);
  const right = clamp(Number(data.right || 0), 0, 99);
  const top = clamp(Number(data.top || 0), 0, 99);
  const bottom = clamp(Number(data.bottom || 0), 0, 99);
  
  const x = (left / 100) * srcW;
  const y = (top / 100) * srcH;
  const width = srcW * (1 - (left + right) / 100);
  const height = srcH * (1 - (top + bottom) / 100);
  
  return {
    x,
    y,
    w: width,
    h: height,
    width,
    height,
  };
}

function intersectBounds(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function unionBounds(bounds) {
  const valid = bounds.filter(Boolean);
  if (valid.length === 0) return null;
  const x1 = Math.min(...valid.map((b) => b.x));
  const y1 = Math.min(...valid.map((b) => b.y));
  const x2 = Math.max(...valid.map((b) => b.x + b.w));
  const y2 = Math.max(...valid.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function shapeToSourceRect(shape, srcW, srcH, maskCanvas) {
  const canvasW = maskCanvas?.width || MASK_CANVAS_W;
  const canvasH = maskCanvas?.height || MASK_CANVAS_H;
  return {
    id: shape.id,
    type: shape.type || 'rect',
    x: (Number(shape.x || 0) / canvasW) * srcW,
    y: (Number(shape.y || 0) / canvasH) * srcH,
    w: (Math.abs(Number(shape.width || 0)) / canvasW) * srcW,
    h: (Math.abs(Number(shape.height || 0)) / canvasH) * srcH,
  };
}

function localizeShape(shape, sourceBounds) {
  return {
    ...shape,
    x: shape.x - sourceBounds.x,
    y: shape.y - sourceBounds.y,
  };
}

function handleIndex(edge, fallback) {
  const match = String(edge.targetHandle || '').match(/(\d+)$/);
  return match ? Number(match[1]) : fallback + 1;
}

function buildLayerFromChain(chain, mergeNode, inputEdge, order, options = {}) {
  const sourceNode = chain.find((node) => node.type === 'source');
  if (!sourceNode) return null;

  // TRANSFORM is optional — use identity defaults if absent
  // Skip nodes disabled/bypassed by the user
  const enabled = (node) => !node.data?.disabled;
  const transformNode = [...chain].reverse().find((node) => node.type === 'transform' && enabled(node));

  const transformIndex = transformNode
    ? chain.findIndex((node) => node.id === transformNode.id)
    : chain.length;
  const upstream = chain.slice(0, transformIndex);
  const searchNodes = upstream.length > 0 ? upstream : chain;
  const cropNode = [...searchNodes].reverse().find((node) => node.type === 'crop' && enabled(node));
  const maskNode = [...searchNodes].reverse().find((node) => node.type === 'mask' && enabled(node));
  const blurNode = [...chain].reverse().find((node) => node.type === 'blur' && enabled(node));

  const srcW = Number(options.srcW || sourceNode.data?.width || 1920);
  const srcH = Number(options.srcH || sourceNode.data?.height || 1080);
  
  const fullBounds = getCropBounds(null, srcW, srcH);
  const cropBounds = cropNode ? getCropBounds(cropNode, srcW, srcH) : null;
  const maskClipBounds = cropBounds || fullBounds;

  const maskCanvas = maskNode?.data?.maskCanvas || { width: MASK_CANVAS_W, height: MASK_CANVAS_H };
  const maskRects = (maskNode?.data?.rects || [])
    .map((shape) => shapeToSourceRect(shape, srcW, srcH, maskCanvas))
    .map((shape) => intersectBounds(shape, maskClipBounds) && { ...shape, ...intersectBounds(shape, maskClipBounds) })
    .filter(Boolean);
  const maskBounds = unionBounds(maskRects);
  const subtractMode = Boolean(maskNode?.data?.subtractMode ?? maskNode?.data?.invert ?? false);
  const sourceBounds = subtractMode ? (cropBounds || fullBounds) : (maskBounds || cropBounds || fullBounds);
  const transform = transformNode?.data || {};

  const blurRadius = blurNode ? Number(blurNode.data?.radius ?? 20) : 0;
  const feather = maskNode ? Number(maskNode.data?.feather ?? 0) : 0;

  return {
    id: `${mergeNode.id}:${inputEdge.targetHandle || order}:${transformNode?.id || sourceNode.id}`,
    order,
    transformNodeId: transformNode?.id || sourceNode.id,
    source: { width: srcW, height: srcH, filepath: sourceNode.data?.filepath || '' },
    sourceBounds,
    cropBounds,
    maskBounds,
    maskRects,
    localMaskRects: maskRects.map((shape) => localizeShape(shape, sourceBounds)),
    subtractMode,
    blurRadius,
    feather,
    transformPos: { x: transform.posX ?? 50, y: transform.posY ?? 50 },
    transformScale: { x: transform.scaleX ?? 100, y: transform.scaleY ?? 100 },
    transform: {
      scaleX: transform.scaleX ?? 100,
      scaleY: transform.scaleY ?? 100,
      posX: transform.posX ?? 50,
      posY: transform.posY ?? 50,
      rotation: transform.rotation || 0,
    },
  };
}

// Efficient queue with O(1) dequeue using head pointer
class Queue {
  constructor() { this.items = {}; this.head = 0; this.tail = 0; }
  enqueue(item) { this.items[this.tail++] = item; }
  dequeue() {
    if (this.head >= this.tail) return null;
    const item = this.items[this.head];
    delete this.items[this.head++];
    return item;
  }
  get length() { return this.tail - this.head; }
}

function findMergeUpstream(startNodeId, nodes, reverse) {
  const map = byId(nodes);
  const queue = new Queue();
  const visited = new Set();
  queue.enqueue(startNodeId);
  while (queue.length > 0) {
    const current = queue.dequeue();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const node = map.get(current);
    if (node?.type === 'merge') return node;
    for (const edge of reverse.get(current) || []) queue.enqueue(edge.source);
  }
  return null;
}

function resolveOutputLayers(nodes, edges, options = {}) {
  const { reverse } = buildAdjacency(edges);
  let mergeNode = null;

  for (const output of (nodes || []).filter((node) => node.type === 'output')) {
    mergeNode = findMergeUpstream(output.id, nodes, reverse);
    if (mergeNode) break;
  }
  if (!mergeNode) mergeNode = (nodes || []).find((node) => node.type === 'merge');

  if (mergeNode) {
    return (edges || [])
      .filter((edge) => edge.target === mergeNode.id)
      .map((edge, index) => ({ edge, index }))
      .sort((a, b) => handleIndex(a.edge, a.index) - handleIndex(b.edge, b.index))
      .map(({ edge }, index) => {
        const chain = traceChainBackward(edge.source, nodes, reverse);
        return buildLayerFromChain(chain, mergeNode, edge, index, options);
      })
      .filter(Boolean);
  }

  // No MERGE found — trace backward from OUTPUT directly
  const outputNodes = (nodes || []).filter((n) => n.type === 'output');
  for (const outputNode of outputNodes) {
    const inputEdges = (edges || []).filter((e) => e.target === outputNode.id);
    if (inputEdges.length === 0) continue;
    const virtualMerge = { id: `direct-output-${outputNode.id}`, type: 'merge' };
    const layers = inputEdges
      .map((edge, index) => {
        const chain = traceChainBackward(edge.source, nodes, reverse);
        return buildLayerFromChain(chain, virtualMerge, edge, index, options);
      })
      .filter(Boolean);
    if (layers.length > 0) return layers;
  }

  return [];
}

function roundFilterNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

// Round to nearest even number — required for yuv420p pixel format
function roundEven(v) {
  return Math.max(2, Math.round(v / 2) * 2);
}

function ffBounds(bounds) {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    w: roundEven(bounds.w),
    h: roundEven(bounds.h),
  };
}

function shapeCondition(shape) {
  const x = roundFilterNumber(shape.x);
  const y = roundFilterNumber(shape.y);
  const w = Math.max(1, Number(shape.w));
  const h = Math.max(1, Number(shape.h));
  const x2 = roundFilterNumber(Number(shape.x) + w);
  const y2 = roundFilterNumber(Number(shape.y) + h);

  if (shape.type === 'ellipse') {
    const cx = roundFilterNumber(Number(shape.x) + w / 2);
    const cy = roundFilterNumber(Number(shape.y) + h / 2);
    const rx = roundFilterNumber(w / 2);
    const ry = roundFilterNumber(h / 2);
    return `lte(((X-${cx})*(X-${cx}))/(${rx}*${rx})+((Y-${cy})*(Y-${cy}))/(${ry}*${ry}),1)`;
  }

  return `gte(X,${x})*lte(X,${x2})*gte(Y,${y})*lte(Y,${y2})`;
}

function alphaExpression(layer) {
  const shapes = layer.localMaskRects || [];
  if (shapes.length === 0) return '255';
  const unionCondition = shapes.map(shapeCondition).join('+');
  return layer.subtractMode
    ? `if(${unionCondition},0,255)`
    : `if(${unionCondition},255,0)`;
}

function buildBaseFilter(nodes, edges) {
  const sourceNode = (nodes || []).find((node) => node.type === 'source');
  let blur = null;
  if (sourceNode) {
    const blurNodes = (nodes || []).filter((node) => node.type === 'blur');
    // Only apply global blur if the blur node is directly connected to the source
    // AND there is no mask node in the path (blur on masked layer is handled per-layer)
    blur = blurNodes.find((bn) => {
      const directEdge = (edges || []).some(
        (edge) => edge.source === sourceNode.id && edge.target === bn.id
      );
      if (!directEdge) return false;
      // Ensure this blur is NOT also connected to a merge/transform downstream
      // (which would indicate it belongs to a layer pipeline, not the base)
      const downstreamEdges = (edges || []).filter((e) => e.source === bn.id);
      const hasLayerDownstream = downstreamEdges.some((de) => {
        const targetNode = (nodes || []).find((n) => n.id === de.target);
        return targetNode && (targetNode.type === 'merge' || targetNode.type === 'transform' || targetNode.type === 'mask');
      });
      return !hasLayerDownstream;
    });
  }
  const radius = blur?.data?.radius || 20;
  const base = `[0:v]scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase,crop=${OUTPUT_W}:${OUTPUT_H},format=rgba`;
  return blur ? `${base},boxblur=${radius}:${Math.min(radius, 5)}[base]` : `${base}[base]`;
}

function buildLayerFilter(layer, index, labels, fps = OUTPUT_FPS) {
  const sourceBounds = ffBounds(layer.sourceBounds);
  const sourceW = layer.source?.width || 1920;
  const outputScale = OUTPUT_W / sourceW;
  const scaleX = (layer.transformScale?.x ?? layer.transform?.scaleX ?? 100) / 100;
  const scaleY = (layer.transformScale?.y ?? layer.transform?.scaleY ?? 100) / 100;
  const outW = roundEven(sourceBounds.w * outputScale * scaleX);
  const outH = roundEven(sourceBounds.h * outputScale * scaleY);
  const cropLabel = `layer${index}crop`;
  const alphaLabel = `layer${index}alpha`;
  const rgbaLabel = `layer${index}rgba`;
  const scaledLabel = `layer${index}scaled`;
  const readyLabel = `layer${index}ready`;
  const filters = [];

  filters.push(
    `[0:v]crop=${sourceBounds.w}:${sourceBounds.h}:${sourceBounds.x}:${sourceBounds.y},format=rgba[${cropLabel}]`
  );
  if (layer.feather && layer.feather > 0) {
    const rawAlphaLabel = `layer${index}alpharaw`;
    filters.push(
      `color=c=black:s=${sourceBounds.w}x${sourceBounds.h}:r=${fps}:d=999,format=gray,geq=lum='${alphaExpression(layer)}'[${rawAlphaLabel}]`
    );
    filters.push(
      `[${rawAlphaLabel}]boxblur=${layer.feather}:${Math.min(layer.feather, 5)}[${alphaLabel}]`
    );
  } else {
    filters.push(
      `color=c=black:s=${sourceBounds.w}x${sourceBounds.h}:r=${fps}:d=999,format=gray,geq=lum='${alphaExpression(layer)}'[${alphaLabel}]`
    );
  }
  filters.push(`[${cropLabel}][${alphaLabel}]alphamerge,format=rgba[${rgbaLabel}]`);

  let currentLabel = scaledLabel;
  filters.push(`[${rgbaLabel}]scale=${outW}:${outH}:flags=lanczos,format=rgba[${scaledLabel}]`);

  // Apply blur STRICTLY to this layer's isolated stream — never to the base
  if (layer.blurRadius && layer.blurRadius > 0) {
    const blurredLabel = `layer${index}blurred`;
    filters.push(
      `[${currentLabel}]boxblur=${layer.blurRadius}:${Math.min(layer.blurRadius, 5)},format=rgba[${blurredLabel}]`
    );
    currentLabel = blurredLabel;
  }

  const rotation = layer.transform?.rotation || 0;
  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const rotLabel = `layer${index}rot`;
    filters.push(
      `[${currentLabel}]rotate=${rad.toFixed(4)}:c=none:ow=rotw(${rad.toFixed(4)}):oh=roth(${rad.toFixed(4)}),format=rgba[${rotLabel}]`
    );
    currentLabel = rotLabel;
  }

  labels.push({
    label: currentLabel,
    posX: layer.transformPos?.x ?? layer.transform?.posX ?? 50,
    posY: layer.transformPos?.y ?? layer.transform?.posY ?? 50,
  });

  return filters;
}

function buildFiltergraph(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) return { filtergraph: '', inputCount: 0 };

  const sourceNode = nodes.find((node) => node.type === 'source');
  if (!sourceNode) return { filtergraph: '', inputCount: 0 };

  const sourceW = sourceNode.data?.width || 1920;
  const sourceH = sourceNode.data?.height || 1080;
  const fps = Number(options.fps || OUTPUT_FPS);
  const layerObjects = options.layerObjects || resolveOutputLayers(nodes, edges, {
    srcW: sourceW,
    srcH: sourceH,
  });

  const filters = [buildBaseFilter(nodes, edges)];
  const overlayLabels = [];
  layerObjects.forEach((layer, index) => {
    filters.push(...buildLayerFilter(layer, index, overlayLabels, fps));
  });

  let compositeLabel = 'base';
  overlayLabels.forEach((layer, index) => {
    const outLabel = index === overlayLabels.length - 1 ? 'finalrgba' : `comp${index}`;
    const overlayX = `(${OUTPUT_W}-overlay_w)*${((layer.posX || 0) / 100).toFixed(4)}`;
    const overlayY = `(${OUTPUT_H}-overlay_h)*${((layer.posY || 0) / 100).toFixed(4)}`;
    filters.push(`[${compositeLabel}][${layer.label}]overlay=x='${overlayX}':y='${overlayY}':shortest=1:format=auto[${outLabel}]`);
    compositeLabel = outLabel;
  });

  if (overlayLabels.length === 0) {
    filters.push('[base]format=yuv420p[final]');
  } else {
    filters.push(`[${compositeLabel}]format=yuv420p[final]`);
  }

  return {
    filtergraph: filters.join(';'),
    inputCount: 1,
    layerCount: layerObjects.length,
  };
}

// ═══════════════════════════════════════════════════════════
//  CONCAT SEQUENCE ENGINE
//  Resolves sequential clip inputs from concat nodes and
//  builds the FFmpeg concat demuxer or filter_complex concat.
// ═══════════════════════════════════════════════════════════

function resolveSequenceClips(nodes, edges) {
  const map = byId(nodes);
  const concatNodes = (nodes || []).filter((n) => n.type === 'concat');
  if (concatNodes.length === 0) return [];

  const resolveClips = (node) => {
    if (!node) return [];
    if (node.type === 'source' && node.data?.filepath) {
      return [{
        filepath: node.data.filepath,
        duration: Number(node.data.duration || 0),
        width: Number(node.data.width || 1920),
        height: Number(node.data.height || 1080),
      }];
    }
    if (node.type === 'concat') {
      const incoming = (edges || [])
        .filter((e) => e.target === node.id)
        .map((edge, index) => ({ edge, index }))
        .sort((a, b) => {
          const aMatch = String(a.edge.targetHandle || '').match(/(\\d+)$/);
          const bMatch = String(b.edge.targetHandle || '').match(/(\\d+)$/);
          const aIndex = aMatch ? Number(aMatch[1]) : a.index;
          const bIndex = bMatch ? Number(bMatch[1]) : b.index;
          return aIndex - bIndex || a.index - b.index;
        })
        .map(({ edge }) => edge);
      const clips = [];
      for (const edge of incoming) {
        const srcNode = map.get(edge.source);
        if (srcNode) clips.push(...resolveClips(srcNode));
      }
      return clips;
    }
    return [];
  };

  for (const cn of concatNodes) {
    const clips = resolveClips(cn);
    if (clips.length > 0) return clips;
  }
  return [];
}

// ═══════════════════════════════════════════════════════════
//  BACKGROUND MUSIC ENGINE
//  Resolves audio nodes from graph and builds amix parameters.
// ═══════════════════════════════════════════════════════════

function resolveBackgroundMusic(nodes) {
  const audioNode = (nodes || []).find((n) => n.type === 'audio' && n.data?.filepath && !n.data?.disabled);
  if (!audioNode) return null;
  return {
    filepath: audioNode.data.filepath,
    volume: Number(audioNode.data.volume ?? 50) / 100,
    offset: Number(audioNode.data.offset ?? 0),
    duration: Number(audioNode.data.duration ?? 0),
  };
}

function parseBitrateMbps(value, fallback = 20) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildFFmpegCommand(config) {
const { inputPath, outputPath, nodes, edges, gpuAvailable, settings, trim, layerObjects } = config;
  const outputFps = Number(settings?.fps || OUTPUT_FPS);
  const args = ['-y'];

  // ── Resolve sequence clips ──────────────────────────────
  let sequenceClips = config.clips || [];
  if (sequenceClips.length === 0) {
    sequenceClips = resolveSequenceClips(nodes, edges);
  }
  const hasSequence = sequenceClips.length > 1;

  // ── Resolve background music ────────────────────────────
  const bgMusic = resolveBackgroundMusic(nodes);

  if (hasSequence) {
    // ── CONCAT MODE: Multiple sequential inputs ───────────
    // Add each clip as a separate input with precise input-seeking trims
    sequenceClips.forEach((clip) => {
      const trimInSec = (clip.trimIn ?? 0) / 1000;
      const trimOutSec = (clip.trimOut ?? (clip.duration * 1000)) / 1000;
      const durationSec = trimOutSec - trimInSec;
      
      args.push('-ss', trimInSec.toFixed(3));
      args.push('-t', durationSec.toFixed(3));
      args.push('-i', clip.filepath);
    });

    // Build concat filter_complex
    const concatInputs = sequenceClips.map((_, i) => `[${i}:v]`).join('');
    const concatAudioInputs = sequenceClips.map((_, i) => `[${i}:a]`).join('');
    const concatFilterParts = [];

    // Scale all inputs to uniform resolution before concatenating
    sequenceClips.forEach((clip, i) => {
      concatFilterParts.push(
        `[${i}:v]scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase,crop=${OUTPUT_W}:${OUTPUT_H},setsar=1,fps=${outputFps}[v${i}]`
      );
    });

    const scaledInputs = sequenceClips.map((_, i) => `[v${i}]`).join('');
    concatFilterParts.push(
      `${scaledInputs}concat=n=${sequenceClips.length}:v=1:a=0[concatv]`
    );

    // Audio concat
    concatFilterParts.push(
      `${concatAudioInputs}concat=n=${sequenceClips.length}:v=0:a=1[concata]`
    );

    let videoOut = 'concatv';
    let audioOut = 'concata';

    // Apply layer effects on top of concatenated video if layerObjects exist
    if (layerObjects && layerObjects.length > 0) {
      // Use the concatenated stream as the base
      const overlayLabels = [];
      const layerFilters = [];

      layerObjects.forEach((layer, index) => {
        const sourceBounds = ffBounds(layer.sourceBounds);
        const sourceW = layer.source?.width || 1920;
        const outputScale = OUTPUT_W / sourceW;
        const scaleX = (layer.transformScale?.x ?? 100) / 100;
        const scaleY = (layer.transformScale?.y ?? 100) / 100;
        const outW = roundEven(sourceBounds.w * outputScale * scaleX);
        const outH = roundEven(sourceBounds.h * outputScale * scaleY);
        const lbl = `seqlayer${index}`;

        layerFilters.push(
          `[concatv]crop=${sourceBounds.w}:${sourceBounds.h}:${sourceBounds.x}:${sourceBounds.y},scale=${outW}:${outH}:flags=lanczos,format=rgba[${lbl}]`
        );

        let currentLabel = lbl;
        if (layer.blurRadius && layer.blurRadius > 0) {
          const blurredLabel = `${lbl}blur`;
          layerFilters.push(
            `[${currentLabel}]boxblur=${layer.blurRadius}:${Math.min(layer.blurRadius, 5)},format=rgba[${blurredLabel}]`
          );
          currentLabel = blurredLabel;
        }

        overlayLabels.push({
          label: currentLabel,
          posX: layer.transformPos?.x ?? 50,
          posY: layer.transformPos?.y ?? 50,
        });
      });

      concatFilterParts.push(...layerFilters);
    }

    // Mix background music if present
    if (bgMusic) {
      const bgInputIndex = sequenceClips.length;
      args.push('-i', bgMusic.filepath);

      const delayMs = Math.round(bgMusic.offset * 1000);
      const volumeStr = bgMusic.volume.toFixed(2);

      if (delayMs > 0) {
        concatFilterParts.push(
          `[${bgInputIndex}:a]adelay=${delayMs}|${delayMs},volume=${volumeStr}[bgm]`
        );
      } else {
        concatFilterParts.push(
          `[${bgInputIndex}:a]volume=${volumeStr}[bgm]`
        );
      }

      concatFilterParts.push(
        `[${audioOut}][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`
      );
      audioOut = 'mixeda';
    }

    // Final output format
    concatFilterParts.push(`[${videoOut}]format=yuv420p[final]`);

    args.push('-filter_complex', concatFilterParts.join(';'));
    args.push('-map', '[final]');
    args.push('-map', `[${audioOut}]`);

  } else {
    // ── SINGLE INPUT MODE (original behavior) ─────────────
    if (trim && (trim.in > 0 || trim.out < 100)) {
      const duration = config.duration || 120;
      if (trim.in > 0) args.push('-ss', ((trim.in / 100) * duration).toFixed(2));
      if (trim.out < 100) args.push('-to', ((trim.out / 100) * duration).toFixed(2));
    }

    // Set input framerate BEFORE -i to interpret source at the target rate
    // This prevents frame dropping when outputting at 120/144 fps
    args.push('-r', String(outputFps));
    args.push('-i', inputPath);

    // Add background music as a separate input if present
    if (bgMusic) {
      args.push('-i', bgMusic.filepath);
    }

    const { filtergraph } = buildFiltergraph(nodes, edges, { layerObjects, fps: outputFps });
    if (filtergraph) {
      if (bgMusic) {
        // Inject amix into the filtergraph for background music mixing
        const delayMs = Math.round(bgMusic.offset * 1000);
        const volumeStr = bgMusic.volume.toFixed(2);

        let bgmFilter;
        if (delayMs > 0) {
          bgmFilter = `[1:a]adelay=${delayMs}|${delayMs},volume=${volumeStr}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`;
        } else {
          bgmFilter = `[1:a]volume=${volumeStr}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`;
        }

        args.push('-filter_complex', filtergraph + ';' + bgmFilter);
        args.push('-map', '[final]');
        args.push('-map', '[mixeda]');
      } else {
        args.push('-filter_complex', filtergraph);
        args.push('-map', '[final]');
        args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '192k');
      }
    } else {
      if (bgMusic) {
        const delayMs = Math.round(bgMusic.offset * 1000);
        const volumeStr = bgMusic.volume.toFixed(2);

        let bgmFilter;
        if (delayMs > 0) {
          bgmFilter = `[1:a]adelay=${delayMs}|${delayMs},volume=${volumeStr}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`;
        } else {
          bgmFilter = `[1:a]volume=${volumeStr}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`;
        }
        args.push('-filter_complex', bgmFilter);
        args.push('-map', '0:v');
        args.push('-map', '[mixeda]');
      } else {
        args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '192k');
      }
    }
  }

  // ── Codec & quality settings (shared) ───────────────────
  args.push('-c:a', 'aac', '-b:a', '192k');

  const codec = settings?.codec || (gpuAvailable ? 'h264_nvenc' : 'libx264');
  const bitrate = settings?.bitrate || '20M';
  const bitrateMbps = parseBitrateMbps(bitrate, 20);
  const maxrate = `${bitrateMbps + 10}M`;

  args.push('-c:v', codec);
  if (codec.includes('nvenc')) {
    args.push('-preset', 'p6');
    args.push('-rc', 'vbr');
    args.push('-cq', '19');
  } else if (codec === 'libx264') {
    args.push('-preset', 'slow');
  }

  args.push('-b:v', bitrate);
  args.push('-maxrate', maxrate);
  args.push('-bufsize', `${bitrateMbps * 2}M`);
  args.push('-r', String(outputFps));
  args.push('-pix_fmt', 'yuv420p');
  args.push('-colorspace', 'bt709');
  args.push('-color_primaries', 'bt709');
  args.push('-color_trc', 'bt709');
  args.push(outputPath);

  return args;
}

// Active FFmpeg process reference — for kill on cancel/quit
let activeFFmpegProcess = null;

function validateRuntimeInputs(config) {
  const errors = [];
  const inputPaths = [];

  if (Array.isArray(config.clips) && config.clips.length > 0) {
    for (const [index, clip] of config.clips.entries()) {
      if (!clip?.filepath) errors.push(`Timeline clip ${index + 1} has no media path.`);
      else inputPaths.push(clip.filepath);
    }
  } else if (config.inputPath) {
    inputPaths.push(config.inputPath);
  } else {
    errors.push('No input media path was provided.');
  }

  for (const filepath of inputPaths) {
    if (!fs.existsSync(filepath)) {
      errors.push(`Media file not found: ${filepath}`);
    }
  }

  const audioNode = (config.nodes || []).find(
    (node) => node.type === 'audio' && node.data?.filepath && !node.data?.disabled
  );
  if (audioNode && !fs.existsSync(audioNode.data.filepath)) {
    errors.push(`Background music file not found: ${audioNode.data.filepath}`);
  }

  if (!config.outputPath) {
    errors.push('No output path was provided.');
  } else {
    const outputDir = require('path').dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      errors.push(`Output directory does not exist: ${outputDir}`);
    }
  }

  return errors;
}

function runExport(config, onProgress) {
  return new Promise((resolve, reject) => {
    const runtimeErrors = validateRuntimeInputs(config);
    if (runtimeErrors.length > 0) {
      reject(new Error(runtimeErrors.join('\\n')));
      return;
    }

    const args = buildFFmpegCommand(config);

    console.log('--- AkumaUI FFmpeg Command ---');
    console.log('ffmpeg ' + args.join(' '));
    console.log('------------------------------');

    const ffmpeg = spawn(getFFmpegPath(), args, { windowsHide: true });
    activeFFmpegProcess = ffmpeg;
    let stderr = '';
    let duration = config.duration || 0;

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      if (!duration) {
        const durMatch = text.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.?\d*)/);
        if (durMatch) {
          duration = parseInt(durMatch[1], 10) * 3600 + parseInt(durMatch[2], 10) * 60 + parseFloat(durMatch[3]);
        }
      }

      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const currentTime = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
        const percent = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;
        const speedMatch = text.match(/speed=\s*([0-9.]+)x/);
        const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;
        onProgress({ currentTime, duration, percent, speed, raw: text });
      }
    });

    ffmpeg.on('close', (code) => {
      activeFFmpegProcess = null;
      if (code === 0) resolve({ success: true });
      else reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-1200)}`));
    });

    ffmpeg.on('error', (err) => {
      activeFFmpegProcess = null;
      reject(new Error(`Failed to start FFmpeg: ${err.message}. Make sure ffmpeg is in your system PATH.`));
    });
  });
}

function cancelExport() {
  if (activeFFmpegProcess) {
    try { activeFFmpegProcess.kill('SIGTERM'); } catch (e) { /* already dead */ }
    activeFFmpegProcess = null;
    return true;
  }
  return false;
}

module.exports = {
  detectNvidiaGpu,
  buildFiltergraph,
  buildFFmpegCommand,
  runExport,
  cancelExport,
  resolveSequenceClips,
  resolveBackgroundMusic,
  OUTPUT_W,
  OUTPUT_H,
  OUTPUT_FPS,
};
