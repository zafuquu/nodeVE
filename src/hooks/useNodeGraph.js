import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import { resolveOutputLayers, MASK_CANVAS_W, MASK_CANVAS_H } from '../utils/graphLayers';

// ── Default nodes: SOURCE → CROP ──────────────────────────
const initialNodes = [
  {
    id: 'source-1',
    type: 'source',
    position: { x: 80, y: 260 },
    data: { label: 'SOURCE', filename: '', filepath: '', duration: 0, width: 0, height: 0 },
  },
  {
    id: 'crop-1',
    type: 'crop',
    position: { x: 440, y: 220 },
    data: { label: 'CROP', top: 0, bottom: 0, left: 0, right: 0 },
  },
];

const initialEdges = [
  {
    id: 'e-source-crop',
    source: 'source-1',
    target: 'crop-1',
    type: 'default',
    animated: true,
    style: { stroke: '#555555', strokeWidth: 1.5 },
  },
];

function getDefaultData(type) {
  switch (type) {
    case 'source':
      return {
        label: 'SOURCE',
        filename: '',
        filepath: '',
        duration: 0,
        width: 0,
        height: 0,
        scaleX: 100,
        scaleY: 100,
        posX: 50,
        posY: 50,
        lockAspect: true,
      };
    case 'crop':
      return { label: 'CROP', top: 0, bottom: 0, left: 0, right: 0 };
    case 'mask':
      return {
        label: 'MASK',
        shape: 'rectangle',
        feather: 5,
        invert: false,
        subtractMode: false,
        rects: [],
        maskBounds: null,
        maskCanvas: { width: MASK_CANVAS_W, height: MASK_CANVAS_H },
      };
    case 'transform':
      return { label: 'TRANSFORM+', scaleX: 100, scaleY: 100, posX: 50, posY: 50, rotation: 0, lockAspect: true };
    case 'blur':
      return { label: 'BLUR', radius: 20, stretch: true };
    case 'blend':
      return { label: 'BLEND', layers: [] };
    case 'output':
      return { label: 'OUTPUT' };
    case 'merge':
      return { label: 'MERGE' };
    case 'concat':
      return { label: 'CONCAT SEQUENCE' };
    case 'audio':
      return { label: 'BACKGROUND MUSIC', filename: '', filepath: '', volume: 50, offset: 0, duration: 0 };
    default:
      return { label: type.toUpperCase() };
  }
}

function asNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
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
        width: asNumber(data.width),
        height: asNumber(data.height),
        fps: asNumber(data.fps),
        aspect: String(data.aspect || 'unknown'),
        scaleX: asNumber(data.scaleX, 100),
        scaleY: asNumber(data.scaleY, 100),
        posX: asNumber(data.posX, 50),
        posY: asNumber(data.posY, 50),
        lockAspect: data.lockAspect !== false,
        mediaMissing: Boolean(data.mediaMissing),
      };
    case 'crop':
      return {
        label: 'CROP',
        top: asNumber(data.top),
        bottom: asNumber(data.bottom),
        left: asNumber(data.left),
        right: asNumber(data.right),
      };
    case 'mask':
      return {
        label: 'MASK',
        shape: String(data.shape || 'rectangle'),
        feather: asNumber(data.feather),
        invert: Boolean(data.invert),
        subtractMode: Boolean(data.subtractMode ?? data.invert),
        maskBounds: data.maskBounds ? {
          x: asNumber(data.maskBounds.x),
          y: asNumber(data.maskBounds.y),
          w: asNumber(data.maskBounds.w ?? data.maskBounds.width),
          h: asNumber(data.maskBounds.h ?? data.maskBounds.height),
        } : null,
        maskCanvas: {
          width: asNumber(data.maskCanvas?.width, MASK_CANVAS_W),
          height: asNumber(data.maskCanvas?.height, MASK_CANVAS_H),
        },
        rects: (data.rects || []).map((rect, index) => ({
          id: String(rect.id || `rect-${index}`),
          type: String(rect.type || 'rect'),
          name: String(rect.name || `rect ${index + 1}`),
          x: asNumber(rect.x),
          y: asNumber(rect.y),
          width: asNumber(rect.width),
          height: asNumber(rect.height),
          opacity: asNumber(rect.opacity, 1),
          feather: asNumber(rect.feather),
          roundness: asNumber(rect.roundness),
        })),
      };
    case 'transform':
      return {
        label: 'TRANSFORM+',
        scaleX: asNumber(data.scaleX, 100),
        scaleY: asNumber(data.scaleY, 100),
        posX: asNumber(data.posX, 50),
        posY: asNumber(data.posY, 50),
        rotation: asNumber(data.rotation),
        lockAspect: data.lockAspect !== false,
      };
    case 'blur':
      return {
        label: 'BLUR',
        radius: asNumber(data.radius, 20),
        stretch: data.stretch !== false,
      };
    case 'concat':
      return { label: String(data.label || 'CONCAT SEQUENCE') };
    case 'audio':
      return {
        label: String(data.label || 'BACKGROUND MUSIC'),
        filename: String(data.filename || ''),
        filepath: String(data.filepath || ''),
        volume: asNumber(data.volume, 50),
        offset: asNumber(data.offset, 0),
        duration: asNumber(data.duration, 0),
      };
    default:
      return {
        label: String(data.label || node.type?.toUpperCase?.() || ''),
      };
  }
}

/**
 * Compute a deterministic hash of the graph's topology (node types + edge connectivity).
 * This excludes node positions so that dragging nodes doesn't trigger re-resolution.
 */
function computeTopologyHash(nodes, edges) {
  const nodeHashes = nodes
    .map(n => `${n.id}:${n.type}:${JSON.stringify(n.data)}`)
    .sort()
    .join('|');
  const edgeHashes = edges
    .map(e => `${e.source}>${e.target}:${e.sourceHandle||''}:${e.targetHandle||''}`)
    .sort()
    .join('|');
  return `${nodeHashes}::${edgeHashes}`;
}

/**
 * Custom hook for managing the node graph (React Flow nodes + edges).
 * Provides debounced graph resolution, undo/redo, and all graph operations.
 */
export function useNodeGraph() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // ── Undo/Redo stacks ────────────────────────────────────
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const undoEnabledRef = useRef(true); // Toggle off during undo/redo replay

  const pushUndo = useCallback((nodesSnapshot, edgesSnapshot) => {
    setUndoStack(prev => {
      const next = [...prev, { nodes: nodesSnapshot, edges: edgesSnapshot }];
      // Cap undo stack at 50 entries
      return next.length > 50 ? next.slice(-50) : next;
    });
    setRedoStack([]); // Clear redo on new action
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    undoEnabledRef.current = false;
    const currentSnapshot = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, currentSnapshot]);
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setTimeout(() => { undoEnabledRef.current = true; }, 0);
  }, [undoStack, nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    undoEnabledRef.current = false;
    const currentSnapshot = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    const next = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, currentSnapshot]);
    setNodes(next.nodes);
    setEdges(next.edges);
    setTimeout(() => { undoEnabledRef.current = true; }, 0);
  }, [redoStack, nodes, edges, setNodes, setEdges]);

  // Wrap setNodes to also push undo state
  const setNodesWithUndo = useCallback((updater) => {
    setNodes(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (undoEnabledRef.current) {
        pushUndo(prev, edges);
      }
      return next;
    });
  }, [setNodes, edges, pushUndo]);

  const setEdgesWithUndo = useCallback((updater) => {
    setEdges(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (undoEnabledRef.current) {
        pushUndo(nodes, prev);
      }
      return next;
    });
  }, [setEdges, nodes, pushUndo]);

  // ── GPU info ────────────────────────────────────────────
  const [gpuInfo, setGpuInfo] = useState({ available: false, gpuName: null });

  useEffect(() => {
    if (window.clipForge?.checkGpu) {
      window.clipForge.checkGpu().then(setGpuInfo).catch(() => {});
    }
  }, []);

  // ── Mask editor state ───────────────────────────────────
  const [maskEditorState, setMaskEditorState] = useState({ isOpen: false, nodeId: null, maskData: null });

  useEffect(() => {
    const handleOpenMaskEditor = (e) => {
      setMaskEditorState({
        isOpen: true,
        nodeId: e.detail.nodeId,
        maskData: e.detail.maskData,
      });
    };
    window.addEventListener('open-mask-editor', handleOpenMaskEditor);
    return () => window.removeEventListener('open-mask-editor', handleOpenMaskEditor);
  }, []);

  // ── Presets ─────────────────────────────────────────────
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    if (window.clipForge?.getPresets) {
      window.clipForge.getPresets().then(list => setPresets(list || [])).catch(() => {});
    }
  }, []);

  // ── Edge connectivity serialized for stable dependencies ──
  const edgeConnSerialized = useMemo(() =>
    edges.map(e => `${e.source}>${e.target}:${e.sourceHandle||''}:${e.targetHandle||''}`).join('|'),
  [edges]);

  // ── Topology hash for debounced graph resolution ─────────
  const topologyHash = useMemo(() => computeTopologyHash(nodes, edges), [nodes, edges]);

  // ── Debounced topology hash (only recompute after 300ms of no changes) ──
  const [debouncedHash, setDebouncedHash] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHash(topologyHash), 300);
    return () => clearTimeout(timer);
  }, [topologyHash]);

  // ── Connected node IDs (only recomputes on edge topology change) ──
  const connectedNodeIds = useMemo(() => {
    const connected = new Set();
    nodes.filter(n => n.type === 'source' && n.data.filepath).forEach(s => connected.add(s.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        if (connected.has(e.source) && !connected.has(e.target)) {
          connected.add(e.target);
          changed = true;
        }
      }
    }
    return connected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeConnSerialized]);

  // ── Source node ──────────────────────────────────────────
  const sourceNode = useMemo(
    () => nodes.find(n => n.type === 'source'),
    [nodes]
  );

  // ── Global aspect ratio ─────────────────────────────────
  const globalAspect = useMemo(() => {
    const src = nodes.find(n => n.type === 'source');
    return src?.data?.aspect || '16:9';
  }, [nodes]);

  // ── Audio bgMusic from graph ────────────────────────────
  const bgMusicParams = useMemo(() => {
    const audioNode = nodes.find(n => n.type === 'audio' && n.data.filepath && !n.data.disabled);
    if (!audioNode) return null;
    return {
      filepath: audioNode.data.filepath,
      volume: Number(audioNode.data.volume ?? 50),
      offset: Number(audioNode.data.offset ?? 0),
    };
  }, [nodes]);

  // ── Resolve layers (debounced via topologyHash) ──────────
  const resolvedLayers = useMemo(() => {
    if (!debouncedHash) return [];
    const { layers } = resolveOutputLayers(nodes, edges, null, {
      srcW: sourceNode?.data?.width || 0,
      srcH: sourceNode?.data?.height || 0,
    });
    return layers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedHash, sourceNode?.data?.width, sourceNode?.data?.height]);

  // ── Node operations ─────────────────────────────────────
  const onConnect = useCallback(
    (params) => setEdgesWithUndo((eds) => addEdge({ ...params, animated: true, style: { stroke: '#555555', strokeWidth: 1.5 } }, eds)),
    [setEdgesWithUndo]
  );

  const updateNodeData = useCallback(
    (nodeId, newData) => {
      setNodesWithUndo((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n))
      );
    },
    [setNodesWithUndo]
  );

  const deleteNode = useCallback(
    (nodeId) => {
      setNodesWithUndo((nds) => nds.filter((n) => n.id !== nodeId));
      setEdgesWithUndo((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodesWithUndo, setEdgesWithUndo]
  );

  const deleteEdge = useCallback((edgeId) => {
    setEdgesWithUndo((eds) => eds.filter((e) => e.id !== edgeId));
  }, [setEdgesWithUndo]);

  // ── Drag and drop ───────────────────────────────────────
  const onDragStart = useCallback((event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  // ── Node data ref-cache for position-only skips ─────────
  const nodeDataCache = useRef({});

  const nodesWithUpdater = useMemo(() => nodes.map((n) => {
    const isConnected = connectedNodeIds.has(n.id);
    const opKey = JSON.stringify({ ...n.data, _isConnected: isConnected });
    const cached = nodeDataCache.current[n.id];
    let nextData;
    if (cached && cached.opKey === opKey) {
      nextData = cached.data;
    } else {
      nextData = {
        ...n.data,
        updateNodeData,
        deleteNode,
        _isConnected: isConnected,
      };
      nodeDataCache.current[n.id] = { opKey, data: nextData };
    }
    return { ...n, data: nextData };
  }), [nodes, updateNodeData, deleteNode, connectedNodeIds]);

  const edgesWithDelete = useMemo(() => edges.map((e) => ({
    ...e,
    type: 'deletable',
    data: { ...e.data, onDelete: deleteEdge },
  })), [edges, deleteEdge]);

  // ── Save / Load template ────────────────────────────────
  const flowToTemplate = useCallback((reactFlowInstance, options = {}) => {
    const flow = reactFlowInstance?.toObject();
    if (!flow) return null;

    const includeMedia = options.includeMedia === true;
    const cleanedNodes = (flow.nodes || []).map(node => {
      if (!includeMedia && node.type === 'source') {
        return {
          ...node,
          data: { ...node.data, filepath: '', filename: '', duration: 0, width: 0, height: 0, fps: 0 }
        };
      }
      if (!includeMedia && node.type === 'audio') {
        return { ...node, data: { ...node.data, filepath: '', filename: '', duration: 0 } };
      }
      return node;
    });

    return {
      ...flow,
      nodes: cleanedNodes,
      savedVideoPath: includeMedia ? (sourceNode?.data?.filepath || '') : '',
    };
  }, [sourceNode]);

  return {
          ...node,
          data: { ...node.data, filepath: '', filename: '', duration: 0, width: 0, height: 0, fps: 0 }
        };
      }
      if (node.type === 'audio') {
        return { ...node, data: { ...node.data, filepath: '', filename: '', duration: 0 } };
      }
      return node;
    });
    return { ...flow, nodes: cleanedNodes, savedVideoPath: '', clips: [] };
  }, []);

  return {
    // State
    nodes,
    setNodes,
    edges,
    setEdges,
    onNodesChange,
    onEdgesChange,
    gpuInfo,
    maskEditorState,
    setMaskEditorState,
    presets,
    // Computed
    edgeConnSerialized,
    topologyHash,
    debouncedHash,
    connectedNodeIds,
    sourceNode,
    globalAspect,
    bgMusicParams,
    resolvedLayers,
    // Enhanced operations (with undo)
    nodesWithUpdater,
    edgesWithDelete,
    onConnect,
    updateNodeData,
    deleteNode,
    deleteEdge,
    onDragStart,
    // Undo/Redo
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    // Template
    flowToTemplate,
    getDefaultData,
    sanitizeNodeData,
  };
}