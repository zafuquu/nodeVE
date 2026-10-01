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

  if (!sourceNode?.data?.filepath) {
    errors.push('No source media file is loaded.');
  }

  const sourceData = sourceNode?.data || {};
  if (sourceData.duration != null && (!finite(sourceData.duration) || Number(sourceData.duration) < 0)) {
    errors.push('Source duration is invalid.');
  }
  if (sourceData.width != null && (!finite(sourceData.width) || Number(sourceData.width) <= 0)) {
    warnings.push('Source width is missing or invalid; the renderer may use its fallback dimensions.');
  }
  if (sourceData.height != null && (!finite(sourceData.height) || Number(sourceData.height) <= 0)) {
    warnings.push('Source height is missing or invalid; the renderer may use its fallback dimensions.');
  }

  for (const [index, clip] of (clips || []).entries()) {
    if (!clip?.filepath) {
      errors.push(`Timeline clip ${index + 1} has no media path.`);
      continue;
    }

    const duration = Number(clip.duration);
    const trimIn = Number(clip.trimIn);
    const trimOut = Number(clip.trimOut);

    if (!Number.isFinite(duration) || duration < 0) {
      errors.push(`Timeline clip ${index + 1} has an invalid duration.`);
    }
    if (!Number.isFinite(trimIn) || !Number.isFinite(trimOut)) {
      errors.push(`Timeline clip ${index + 1} has an invalid trim range.`);
    } else if (duration > 0 && (trimIn < 0 || trimOut < trimIn || trimOut > duration * 1000)) {
      errors.push(`Timeline clip ${index + 1} has a trim range outside its source duration.`);
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
