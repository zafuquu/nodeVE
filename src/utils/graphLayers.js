export const MASK_CANVAS_W = 640;
export const MASK_CANVAS_H = 360;

const HANDLE_RE = /(\d+)$/;

function byId(nodes) {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function buildAdjacency(edges) {
  const forward = new Map();
  const reverse = new Map();

  for (const edge of edges || []) {
    if (!forward.has(edge.source)) forward.set(edge.source, []);
    if (!reverse.has(edge.target)) reverse.set(edge.target, []);
    forward.get(edge.source).push(edge);
    reverse.get(edge.target).push(edge);
  }

  return { forward, reverse };
}

function handleIndex(edge, fallback) {
  const match = String(edge.targetHandle || '').match(HANDLE_RE);
  return match ? Number(match[1]) : fallback + 1;
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
    const preferred = parents.find((edge) => map.get(edge.source)?.type === 'source') || parents[0];
    current = preferred?.source || null;
  }

  return chain;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBounds(bounds) {
  const x = Number(bounds?.x || 0);
  const y = Number(bounds?.y || 0);
  const w = Math.max(1, Number(bounds?.w ?? bounds?.width ?? 1));
  const h = Math.max(1, Number(bounds?.h ?? bounds?.height ?? 1));
  return { x, y, w, h };
}

function intersectBounds(a, b) {
  const ax = a.x;
  const ay = a.y;
  const aw = a.w;
  const ah = a.h;
  const bx = b.x;
  const by = b.y;
  const bw = b.w;
  const bh = b.h;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);

  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function unionBounds(boundsList) {
  const valid = boundsList.filter(Boolean);
  if (valid.length === 0) return null;

  const x1 = Math.min(...valid.map((b) => b.x));
  const y1 = Math.min(...valid.map((b) => b.y));
  const x2 = Math.max(...valid.map((b) => b.x + b.w));
  const y2 = Math.max(...valid.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function getCropBounds(cropNode, srcW, srcH) {
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

function shapeToSourceRect(shape, srcW, srcH, maskCanvas) {
  const canvasW = maskCanvas?.width || MASK_CANVAS_W;
  const canvasH = maskCanvas?.height || MASK_CANVAS_H;
  const x = Number(shape.x || 0);
  const y = Number(shape.y || 0);
  const w = Math.abs(Number(shape.width || 0));
  const h = Math.abs(Number(shape.height || 0));
  const sourceRect = {
    x: (x / canvasW) * srcW,
    y: (y / canvasH) * srcH,
    w: (w / canvasW) * srcW,
    h: (h / canvasH) * srcH,
  };

  return {
    id: shape.id,
    type: shape.type || 'rect',
    name: shape.name,
    opacity: shape.opacity ?? 1,
    feather: shape.feather || 0,
    roundness: shape.roundness || 0,
    ...normalizeBounds(sourceRect),
  };
}

function clipShapeToBounds(shape, bounds) {
  const clipped = intersectBounds(shape, bounds);
  if (!clipped) return null;
  return {
    ...shape,
    ...clipped,
  };
}

function localizeShape(shape, sourceBounds) {
  return {
    ...shape,
    x: shape.x - sourceBounds.x,
    y: shape.y - sourceBounds.y,
  };
}

function resolveSourceClips(startNode, nodes, edges) {
  const map = byId(nodes);
  if (!startNode) return [];
  
  if (startNode.type === 'source') {
    return [{
      id: startNode.id,
      filename: startNode.data?.filename || '',
      filepath: startNode.data?.filepath || '',
      duration: Number(startNode.data?.duration || 0),
      width: Number(startNode.data?.width || 0),
      height: Number(startNode.data?.height || 0),
      fps: Number(startNode.data?.fps || 0),
    }];
  }

  if (startNode.type === 'concat') {
    const incoming = (edges || [])
      .filter((e) => e.target === startNode.id)
      .map((edge, index) => ({ edge, index }))
      .sort((a, b) => handleIndex(a.edge, a.index) - handleIndex(b.edge, b.index))
      .map(({ edge }) => edge);

    const clips = [];
    for (const edge of incoming) {
      const srcNode = map.get(edge.source);
      if (srcNode) {
        clips.push(...resolveSourceClips(srcNode, nodes, edges));
      }
    }
    return clips;
  }

  return [];
}

/**
 * Build a layer descriptor from a node chain.
 * TRANSFORM node is optional — defaults to identity (100% scale, centered).
 */
function buildLayerFromChain(chain, mergeNode, inputEdge, order, options = {}) {
  const concatNode = chain.find((node) => node.type === 'concat');
  const sourceNode = chain.find((node) => node.type === 'source');
  const baseNode = concatNode || sourceNode;
  if (!baseNode) return null;

  const nodes = options.nodes || [];
  const edges = options.edges || [];
  const clips = resolveSourceClips(baseNode, nodes, edges);
  const primaryClip = clips[0] || { width: 1920, height: 1080, duration: 0, filepath: '' };

  // TRANSFORM is optional — use identity defaults if absent
  // Skip nodes that have been disabled (bypassed)
  const enabled = (node) => !node.data?.disabled;
  const transformNode = [...chain].reverse().find((node) => node.type === 'transform' && enabled(node));

  // Upstream = everything before the transform node (or full chain if no transform)
  const transformIndex = transformNode
    ? chain.findIndex((node) => node.id === transformNode.id)
    : chain.length;
  const upstream = chain.slice(0, transformIndex);

  // Search for CROP/MASK in upstream; if no transform, search the full chain
  const searchNodes = upstream.length > 0 ? upstream : chain;
  const cropNode = [...searchNodes].reverse().find((node) => node.type === 'crop' && enabled(node));
  const maskNode = [...searchNodes].reverse().find((node) => node.type === 'mask' && enabled(node));
  const blurNode = [...chain].reverse().find((node) => node.type === 'blur' && enabled(node));

  const srcW = Number(options.srcW || primaryClip.width || 1920);
  const srcH = Number(options.srcH || primaryClip.height || 1080);
  
  const fullBounds = getCropBounds(null, srcW, srcH);
  const cropBounds = cropNode ? getCropBounds(cropNode, srcW, srcH) : null;
  const maskClipBounds = cropBounds || fullBounds;

  const maskCanvas = maskNode?.data?.maskCanvas || { width: MASK_CANVAS_W, height: MASK_CANVAS_H };
  const maskRects = (maskNode?.data?.rects || [])
    .map((shape) => shapeToSourceRect(shape, srcW, srcH, maskCanvas))
    .map((shape) => clipShapeToBounds(shape, maskClipBounds))
    .filter(Boolean);

  const maskBounds = unionBounds(maskRects);
  const subtractMode = Boolean(maskNode?.data?.subtractMode ?? maskNode?.data?.invert ?? false);
  const sourceBounds = subtractMode
    ? (cropBounds || fullBounds)
    : (maskBounds || cropBounds || fullBounds);
  const localMaskRects = maskRects.map((shape) => localizeShape(shape, sourceBounds));
  const transform = transformNode
    ? (transformNode.data || {})
    : {
        scaleX: sourceNode?.data?.scaleX ?? 100,
        scaleY: sourceNode?.data?.scaleY ?? 100,
        posX: sourceNode?.data?.posX ?? 50,
        posY: sourceNode?.data?.posY ?? 50,
        rotation: 0,
      };

  const blurRadius = blurNode ? Number(blurNode.data?.radius ?? 20) : 0;
  const feather = maskNode ? Number(maskNode.data?.feather ?? 0) : 0;

  return {
    id: `${mergeNode.id}:${inputEdge.targetHandle || order}:${transformNode?.id || baseNode.id}`,
    order,
    mergeNodeId: mergeNode.id,
    inputHandle: inputEdge.targetHandle || null,
    inputEdgeId: inputEdge.id,
    sourceNodeId: baseNode.id,
    cropNodeId: cropNode?.id || null,
    maskNodeId: maskNode?.id || null,
    transformNodeId: transformNode?.id || baseNode.id,
    source: {
      width: srcW,
      height: srcH,
      filepath: primaryClip.filepath || '',
    },
    clips,
    cropBounds,
    sourceBounds: normalizeBounds(sourceBounds),
    maskBounds: maskBounds ? normalizeBounds(maskBounds) : null,
    maskRects,
    localMaskRects,
    subtractMode,
    blurRadius,
    feather,
    transformPos: {
      x: transform.posX ?? 50,
      y: transform.posY ?? 50,
    },
    transformScale: {
      x: transform.scaleX ?? 100,
      y: transform.scaleY ?? 100,
    },
    transform: {
      scaleX: transform.scaleX ?? 100,
      scaleY: transform.scaleY ?? 100,
      posX: transform.posX ?? 50,
      posY: transform.posY ?? 50,
      rotation: transform.rotation || 0,
    },
  };
}

function findMergeUpstream(startNodeId, nodes, reverse) {
  const map = byId(nodes);
  const queue = [startNodeId];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const node = map.get(current);
    if (node?.type === 'merge') return node;

    for (const edge of reverse.get(current) || []) {
      queue.push(edge.source);
    }
  }

  return null;
}

export function findOutputMerge(nodes, edges, outputNodeId = null) {
  const { reverse } = buildAdjacency(edges);

  if (outputNodeId) {
    const merge = findMergeUpstream(outputNodeId, nodes, reverse);
    if (merge) return merge;
  }

  for (const output of nodes.filter((node) => node.type === 'output')) {
    const merge = findMergeUpstream(output.id, nodes, reverse);
    if (merge) return merge;
  }

  return null;
}

export function resolveMergeLayers(nodes, edges, mergeNodeId, options = {}) {
  const mergeNode = nodes.find((node) => node.id === mergeNodeId && node.type === 'merge');
  if (!mergeNode) return [];

  const { reverse } = buildAdjacency(edges);
  return (edges || [])
    .filter((edge) => edge.target === mergeNode.id)
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => handleIndex(a.edge, a.index) - handleIndex(b.edge, b.index))
    .map(({ edge }, index) => {
      const chain = traceChainBackward(edge.source, nodes, reverse);
      return buildLayerFromChain(chain, mergeNode, edge, index, { ...options, nodes, edges });
    })
    .filter(Boolean);
}

/**
 * Resolve output layers. Supports three topologies:
 *   1. ... → MERGE → OUTPUT  (standard multi-layer)
 *   2. ... → OUTPUT           (direct single-layer, no MERGE)
 *   3. No output connected    (returns empty)
 */
export function resolveOutputLayers(nodes, edges, outputNodeId = null, options = {}) {
  // First try the standard path: find a MERGE node upstream of OUTPUT
  const mergeNode = findOutputMerge(nodes, edges, outputNodeId);
  if (mergeNode) {
    return {
      mergeNode,
      layers: resolveMergeLayers(nodes, edges, mergeNode.id, options),
    };
  }

  // No MERGE found — build layers by tracing backward from OUTPUT directly.
  // This handles SOURCE → CROP → OUTPUT, SOURCE → TRANSFORM → OUTPUT, etc.
  const { reverse } = buildAdjacency(edges);
  const outputNodes = outputNodeId
    ? nodes.filter((n) => n.id === outputNodeId && n.type === 'output')
    : nodes.filter((n) => n.type === 'output');

  for (const outputNode of outputNodes) {
    const inputEdges = (edges || []).filter((e) => e.target === outputNode.id);
    if (inputEdges.length === 0) continue;

    const virtualMerge = { id: `direct-output-${outputNode.id}`, type: 'merge' };
    const layers = inputEdges
      .map((edge, index) => {
        const chain = traceChainBackward(edge.source, nodes, reverse);
        return buildLayerFromChain(chain, virtualMerge, edge, index, { ...options, nodes, edges });
      })
      .filter(Boolean);

    if (layers.length > 0) {
      return { mergeNode: virtualMerge, layers };
    }
  }

  return { mergeNode: null, layers: [] };
}

export function resolveTransformLayer(nodes, edges, transformNodeId, options = {}) {
  const { reverse } = buildAdjacency(edges);
  const mergeNode = { id: `preview-${transformNodeId}` };
  const inputEdge = { id: `preview-edge-${transformNodeId}`, source: transformNodeId, targetHandle: 'preview-1' };
  const chain = traceChainBackward(transformNodeId, nodes, reverse);
  return buildLayerFromChain(chain, mergeNode, inputEdge, 0, { ...options, nodes, edges });
}
