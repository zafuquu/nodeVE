const SUPPORTED_NODE_TYPES = new Set([
  'source',
  'crop',
  'mask',
  'transform',
  'blur',
  'blend',
  'merge',
  'concat',
  'audio',
  'output',
]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function detectCycle(nodes, edges) {
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (adjacency.has(edge.source)) adjacency.get(edge.source).push(edge.target);
  }

  const visiting = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return nodes.some((node) => visit(node.id));
}

/**
 * Lightweight preflight for data that is about to reach the renderer.
 * This deliberately validates the existing model instead of introducing a
 * second project/schema layer.
 */
export function validateExportProject({
  nodes = [],
  edges = [],
  sourceNode = null,
  clips = [],
  settings = {},
  outputPath = '',
}) {
  const errors = [];
  const warnings = [];
  const nodeIds = new Set();

  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push('The node graph is empty.');
    return { valid: false, errors, warnings };
  }

  for (const node of nodes) {
    if (!node?.id) {
      errors.push('The graph contains a node without an ID.');
      continue;
    }
    if (nodeIds.has(node.id)) errors.push(`Duplicate node ID: ${node.id}`);
    nodeIds.add(node.id);

    if (!SUPPORTED_NODE_TYPES.has(node.type)) {
      warnings.push(`Unsupported node type will be ignored: ${node.type || '(unknown)'}`);
    }
  }

  for (const edge of edges || []) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id || '(unnamed)'} references a missing source node.`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id || '(unnamed)'} references a missing target node.`);
    }
  }

  if (detectCycle(nodes, edges || [])) {
    errors.push('The node graph contains a cycle. Remove the circular connection before exporting.');
  }

  const outputNodes = nodes.filter((node) => node.type === 'output');
  if (outputNodes.length === 0) {
    errors.push('The node graph has no OUTPUT node. Connect the composition to an OUTPUT before exporting.');
  } else {
    const reverseAdjacency = new Map();
    for (const node of nodes) reverseAdjacency.set(node.id, []);
    for (const edge of edges || []) {
      if (reverseAdjacency.has(edge.target)) reverseAdjacency.get(edge.target).push(edge.source);
    }
    const sourceIds = new Set(nodes.filter((node) => node.type === 'source').map((node) => node.id));
    const reachesSource = (startId) => {
      const visited = new Set();
      const queue = [startId];
      while (queue.length > 0) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        if (sourceIds.has(id)) return true;
        for (const next of reverseAdjacency.get(id) || []) queue.push(next);
      }
      return false;
    };
    if (!outputNodes.some((node) => reachesSource(node.id))) {
      errors.push('No OUTPUT node is connected to a SOURCE node. Connect a renderable source path before exporting.');
    }
  }

  if (!sourceNode?.data?.filepath) {
    errors.push('No source media file is loaded.');
  }

  const sourceData = sourceNode?.data || {};
  if (sourceData.duration != null && (!finite(sourceData.duration) || Number(sourceData.duration) < 0)) {
    errors.push('Source duration is invalid.');
  }
  if (!finite(sourceData.width) || Number(sourceData.width) <= 0) {
    errors.push('Source width is missing or invalid. Re-import the media so it can be probed.');
  }
  if (!finite(sourceData.height) || Number(sourceData.height) <= 0) {
    errors.push('Source height is missing or invalid. Re-import the media so it can be probed.');
  }
  if (!finite(sourceData.duration) || Number(sourceData.duration) <= 0) {
    errors.push('Source duration is missing or invalid. Re-import the media so it can be probed.');
  }

  for (const [index, clip] of (clips || []).entries()) {
    if (!clip?.filepath) {
      errors.push(`Timeline clip ${index + 1} has no media path.`);
      continue;
    }

    const duration = Number(clip.duration);
    const trimIn = Number(clip.trimIn);
    const trimOut = Number(clip.trimOut);

    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`Timeline clip ${index + 1} has no valid source duration.`);
    }
    if (!Number.isFinite(trimIn) || !Number.isFinite(trimOut)) {
      errors.push(`Timeline clip ${index + 1} has an invalid trim range.`);
    } else if (trimIn < 0 || trimOut <= trimIn || trimOut > duration * 1000) {
      errors.push(`Timeline clip ${index + 1} has an empty or invalid trim range.`);
    }
  }

  // The current FFmpeg sequence renderer concatenates V1 clips. Do not allow
  // timeline positions it cannot represent, because silently collapsing gaps
  // or overlaps would produce a different edit than the user created.
  const v1VideoClips = (clips || [])
    .filter((clip) => String(clip?.trackType || '').toLowerCase() === 'video' && Number(clip?.trackIndex) === 1)
    .slice()
    .sort((a, b) => Number(a?.startOffset || 0) - Number(b?.startOffset || 0));

  if (v1VideoClips.length > 0) {
    const firstStart = Number(v1VideoClips[0]?.startOffset ?? 0);
    if (!Number.isFinite(firstStart) || firstStart < 0) {
      errors.push('The V1 timeline contains an invalid start offset.');
    }

    for (let i = 0; i < v1VideoClips.length - 1; i += 1) {
      const current = v1VideoClips[i];
      const next = v1VideoClips[i + 1];
      const currentStart = Number(current?.startOffset ?? 0);
      const currentTrimIn = Number(current?.trimIn ?? 0);
      const currentTrimOut = Number(current?.trimOut ?? 0);
      const currentEnd = currentStart + Math.max(0, currentTrimOut - currentTrimIn) / 1000;
      const nextStart = Number(next?.startOffset ?? 0);

      if (!Number.isFinite(currentEnd) || !Number.isFinite(nextStart)) {
        errors.push('The V1 timeline contains an invalid clip position.');
        continue;
      }

      if (nextStart < currentEnd - 0.001) {
        errors.push('The V1 timeline contains overlapping clips. Overlaps on the primary V1 program track are not supported yet.');
        break;
      }
    }
  }

  const standaloneAudioClips = (clips || []).filter(
    (clip) => String(clip?.trackType || '').toLowerCase() === 'audio'
  );
  for (const [index, clip] of standaloneAudioClips.entries()) {
    const filepath = String(clip?.filepath || '');
    if (/^blob:/i.test(filepath)) {
      errors.push(`Timeline audio clip ${index + 1} is a browser blob URL and cannot be exported after recording. The recording must be persisted to a local media file first.`);
    }
  }

  const fps = Number(settings.fps);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) {
    errors.push('Export frame rate must be between 1 and 240 fps.');
  }

  if (!outputPath) {
    errors.push('No export output path was selected.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export { SUPPORTED_NODE_TYPES };
