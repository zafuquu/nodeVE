import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import DeletableEdge from './components/DeletableEdge';

const edgeTypes = {
  deletable: DeletableEdge,
};
import PreviewPanel from './components/PreviewPanel';
import MaskEditorModal from './components/MaskEditorModal';
import ExportModal from './components/ExportModal';
import Timeline from './components/Timeline';
import TransportGutter from './components/TransportGutter';
import { VideoProvider } from './context/VideoProvider';
import { useNodeGraph } from './hooks/useNodeGraph';
import { useTimelineData } from './hooks/useTimelineData';
import { useMediaPool } from './hooks/useMediaPool';
import { useExport } from './hooks/useExport';

// ── Drag-and-drop node palette items ──────────────────────
const paletteItems = [
  { type: 'source', label: 'SOURCE', color: '#00c896' },
  { type: 'crop', label: 'CROP', color: '#c8a03e' },
  { type: 'mask', label: 'MASK', color: '#9b59b6' },
  { type: 'transform', label: 'TRANSFORM+', color: '#3498db' },
  { type: 'blur', label: 'BLUR', color: '#2980b9' },
  { type: 'blend', label: 'BLEND', color: '#e84393' },
  { type: 'output', label: 'OUTPUT', color: '#2ecc71' },
  { type: 'merge', label: 'MERGE', color: '#f39c12' },
  { type: 'audio', label: 'AUDIO', color: '#1abc9c' },
];

// ── Flow Editor (inner) ───────────────────────────────────
function FlowEditor() {
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  // ── Hooks ───────────────────────────────────────────────
  const graph = useNodeGraph();
  const timeline = useTimelineData();
  const media = useMediaPool();
  const exportManager = useExport();

  // ── Workspace resizer state ────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isTimelineResizing, setIsTimelineResizing] = useState(false);

  const startResizing = useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((mouseMoveEvent) => {
    if (isResizing) {
      const newWidth = Math.max(310, Math.min(800, mouseMoveEvent.clientX));
      setLeftPanelWidth(newWidth);
      window.dispatchEvent(new Event('resize'));
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const startTimelineResizing = useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsTimelineResizing(true);
  }, []);

  const stopTimelineResizing = useCallback(() => {
    setIsTimelineResizing(false);
  }, []);

  const resizeTimeline = useCallback((mouseMoveEvent) => {
    if (!isTimelineResizing) return;
    const maxHeight = Math.min(Math.round(window.innerHeight * 0.45), 460);
    const newHeight = Math.max(220, Math.min(maxHeight, window.innerHeight - mouseMoveEvent.clientY));
    setTimelineHeight(newHeight);
    window.dispatchEvent(new Event('resize'));
  }, [isTimelineResizing]);

  useEffect(() => {
    if (isTimelineResizing) {
      window.addEventListener('mousemove', resizeTimeline);
      window.addEventListener('mouseup', stopTimelineResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resizeTimeline);
      window.removeEventListener('mouseup', stopTimelineResizing);
    };
  }, [isTimelineResizing, resizeTimeline, stopTimelineResizing]);

  // ── Thumbnail generation on media pool change ──────────
  useEffect(() => {
    media.mediaPool.forEach(asset => {
      if (asset.filepath && !media.thumbnailsCache[asset.filepath]) {
        media.generateThumbnails(asset.filepath, asset.duration);
      }
    });
  }, [media.mediaPool, media.generateThumbnails, media.thumbnailsCache]);

  // ── Drag and Drop onto ReactFlow ───────────────────────
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: graph.getDefaultData(type),
      };

      graph.setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, graph.setNodes, graph.getDefaultData]
  );

  // ── Save / Load templates ───────────────────────────────
  const handleSave = useCallback(() => {
    const project = graph.flowToTemplate(reactFlowInstance, { includeMedia: true });
    if (!project) return;

    project.clips = timeline.sanitizedTimelineClips;
    project.mediaPool = media.mediaPool;
    project.activeClipIndex = timeline.activeClipIndex;
    project.formatVersion = 2;

    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'akumaui_project.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [reactFlowInstance, graph, timeline.sanitizedTimelineClips, timeline.activeClipIndex, media.mediaPool]);

  const loadFlowData = useCallback(async (flow) => {
    if (!flow) return;
    try {
      let loadedNodes = flow.nodes || [];

      const currentSource = graph.sourceNode;
      const currentAudio = graph.nodes.find(n => n.type === 'audio');

      if (!flow.savedVideoPath && currentSource && currentSource.data?.filepath) {
        // Template files intentionally omit media, so preserve the currently
        // loaded source/audio when applying a template. Media-backed project
        // files must instead restore their own saved paths.
        loadedNodes = loadedNodes.map(n => {
          if (n.type === 'source') {
            return {
              ...n,
              data: {
                ...n.data,
                filepath: currentSource.data.filepath,
                filename: currentSource.data.filename,
                duration: currentSource.data.duration,
                width: currentSource.data.width,
                height: currentSource.data.height,
                fps: currentSource.data.fps,
                aspect: currentSource.data.aspect,
                codec: currentSource.data.codec,
              }
            };
          }
          if (n.type === 'audio' && currentAudio && currentAudio.data?.filepath) {
            return {
              ...n,
              data: {
                ...n.data,
                filepath: currentAudio.data.filepath,
                filename: currentAudio.data.filename,
                duration: currentAudio.data.duration,
                volume: currentAudio.data.volume ?? n.data.volume,
                offset: currentAudio.data.offset ?? n.data.offset,
              }
            };
          }
          return n;
        });
      } else if (flow.savedVideoPath && window.clipForge?.probeVideo) {
        try {
          const meta = await window.clipForge.probeVideo(flow.savedVideoPath);
          const w = Number(meta.width) || 0;
          const h = Number(meta.height) || 0;
          const filename = flow.savedVideoPath.split(/[\\/]/).pop();

          loadedNodes = loadedNodes.map((n) => {
            if (n.type === 'source') {
              return {
                ...n,
                data: {
                  ...n.data,
                  filepath: flow.savedVideoPath,
                  filename,
                  duration: meta.duration || 0,
                  width: w,
                  height: h,
                  fps: Number(meta.fps) || 0,
                  aspect: w > h ? '16:9' : '9:16',
                  codec: meta.codec || 'unknown',
                }
              };
            }
            return n;
          });
        } catch (probeErr) {
          console.warn('[loadFlowData] Probe video failed:', probeErr);
          const filename = flow.savedVideoPath.split(/[\\/]/).pop();
          loadedNodes = loadedNodes.map((n) => {
            if (n.type === 'source') {
              return { ...n, data: { ...n.data, filepath: flow.savedVideoPath, filename } };
            }
            return n;
          });
        }
      } else if (flow.savedVideoPath) {
        // Keep the saved path, but do not fabricate media metadata when probing
        // is unavailable. The renderer will validate the real source before export.
        const filename = flow.savedVideoPath.split(/[\\/]/).pop();
        loadedNodes = loadedNodes.map((n) => {
          if (n.type === 'source') {
            return { ...n, data: { ...n.data, filepath: flow.savedVideoPath, filename } };
          }
          return n;
        });
      }

      const projectMediaPaths = [
        ...(Array.isArray(flow.mediaPool) ? flow.mediaPool.map(asset => asset?.filepath) : []),
        ...(Array.isArray(flow.clips) ? flow.clips.map(clip => clip?.filepath) : []),
        ...loadedNodes.filter(n => n.type === 'source' || n.type === 'audio').map(n => n.data?.filepath),
      ].filter(Boolean);

      let missingMediaPaths = new Set();
      if (projectMediaPaths.length > 0 && window.clipForge?.checkMediaPaths) {
        try {
          const checks = await window.clipForge.checkMediaPaths([...new Set(projectMediaPaths)]);
          missingMediaPaths = new Set(
            (checks || []).filter(item => !item.exists).map(item => item.filepath)
          );
        } catch (mediaCheckErr) {
          console.warn('[loadFlowData] Media existence check failed:', mediaCheckErr);
        }
      }

      if (missingMediaPaths.size > 0) {
        console.warn(
          '[loadFlowData] Missing media retained in project:',
          [...missingMediaPaths]
        );
      }

      if (Array.isArray(flow.mediaPool)) {
        media.setMediaPoolAndGenerateThumbnails(
          flow.mediaPool.map(asset => missingMediaPaths.has(asset?.filepath)
            ? { ...asset, mediaMissing: true }
            : { ...asset, mediaMissing: false })
        );
      }

      const sanitizedNodes = loadedNodes.map((n) => ({
        ...n,
        data: {
          ...graph.sanitizeNodeData(n),
          ...(n.type === 'source' || n.type === 'audio'
            ? { mediaMissing: missingMediaPaths.has(n.data?.filepath) }
            : {}),
        },
      }));
      graph.setNodes(sanitizedNodes);
      graph.setEdges(flow.edges || []);

      if (Array.isArray(flow.clips)) {
        timeline.setTimelineClips(
          flow.clips.map(clip => ({
            ...clip,
            mediaMissing: missingMediaPaths.has(clip?.filepath),
          }))
        );
        timeline.setActiveClipIndex(
          Number.isInteger(flow.activeClipIndex) && flow.activeClipIndex >= 0
            ? flow.activeClipIndex
            : 0
        );
      } else if (flow.savedVideoPath && timeline.timelineClips.length === 0) {
        // Do not create an unprobed placeholder clip. A real timeline clip is
        // created only when media metadata is available or when the template
        // already contains explicit clips.
      }

      if (flow.viewport && reactFlowInstance) {
        const { x = 0, y = 0, zoom = 1 } = flow.viewport;
        reactFlowInstance.setViewport({ x, y, zoom });
      }
    } catch (err) {
      console.error('[loadFlowData] Error parsing flow data:', err);
      alert('Invalid template format');
    }
  }, [graph, timeline, reactFlowInstance]);

  const handleLoad = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const flow = JSON.parse(evt.target.result);
          if (flow) await loadFlowData(flow);
        } catch (err) {
          console.error('[handleLoad] Error loading preset file:', err);
          alert('Invalid template file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadFlowData]);

  const handleSelectPreset = useCallback(async (e) => {
    const val = e.target.value;
    if (!val) return;
    if (val === 'browse') {
      handleLoad();
      return;
    }
    if (window.clipForge?.loadPreset) {
      try {
        const flow = await window.clipForge.loadPreset(val);
        if (flow) loadFlowData(flow);
        else alert('Failed to load preset');
      } catch (err) {
        console.error('[handleSelectPreset] Error:', err);
        alert('Error loading preset');
      }
    }
  }, [handleLoad, loadFlowData]);

  // ── Export handler (delegates to useExport hook) ──────
  const handleExport = useCallback(async (settings) => {
    await exportManager.handleExport(
      settings,
      graph.nodes,
      graph.edges,
      graph.gpuInfo,
      graph.sourceNode,
      graph.resolvedLayers,
      timeline.sanitizedTimelineClips,
      (() => {
        const clip = timeline.sanitizedTimelineClips[0];
        if (!clip || !clip.duration) return 0;
        return Math.max(0, Math.min(100, (clip.trimIn / (clip.duration * 1000)) * 100));
      })(), // trimIn from the active timeline clip
      (() => {
        const clip = timeline.sanitizedTimelineClips[0];
        if (!clip || !clip.duration) return 100;
        return Math.max(0, Math.min(100, (clip.trimOut / (clip.duration * 1000)) * 100));
      })(), // trimOut from the active timeline clip
      graph.updateNodeData
    );
  }, [exportManager, graph, timeline]);

  // ── Keyboard Shortcuts ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore when typing in inputs/textareas/selects
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('clipforge:togglePlay'));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('clipforge:stepBack'));
          break;
        case 'ArrowRight':
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('clipforge:stepForward'));
          break;
        case 'KeyS':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSave();
          }
          break;
        case 'KeyZ':
          if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
            e.preventDefault();
            graph.redo();
          } else if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            graph.undo();
          }
          break;
        case 'KeyY':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            graph.redo();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, graph]);

  // ── Source node data for VideoProvider ──────────────────
  const activeFilepath = timeline.activeClip?.filepath || graph.sourceNode?.data?.filepath || null;
  const activeWidth = timeline.activeClip?.width || graph.sourceNode?.data?.width || 0;
  const activeHeight = timeline.activeClip?.height || graph.sourceNode?.data?.height || 0;

  // ── onDropFileOnSource: handler injected into source nodes ──
  const handleDropFileOnSource = useCallback(async (filepath) => {
    if (!window.clipForge?.probeVideo || !filepath) return;

    try {
      const meta = await window.clipForge.probeVideo(filepath);
      const w = Number(meta.width) || 0;
      const h = Number(meta.height) || 0;
      const filename = filepath.split(/[\\/]/).pop();
      const duration = Number(meta.duration) || 0;
      const fps = Number(meta.fps) || 0;
      const aspect = w > 0 && h > 0 ? (w > h ? '16:9' : '9:16') : 'unknown';

      if (duration <= 0 || w <= 0 || h <= 0) {
        throw new Error('Replacement media could not be probed with valid duration and dimensions.');
      }

      const normalizePath = (value) =>
        String(value || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

      const currentSourcePath = graph.sourceNode?.data?.filepath;
      const oldKey = normalizePath(currentSourcePath);
      const missingSource = Boolean(
        currentSourcePath &&
        (
          graph.sourceNode?.data?.mediaMissing ||
          timeline.timelineClips.some(
            clip =>
              normalizePath(clip.filepath) === oldKey &&
              clip.mediaMissing
          )
        )
      );

      const newAsset = {
        id: Math.random().toString(36).substring(7),
        filename,
        filepath,
        duration,
        width: w,
        height: h,
        fps,
        aspect,
        mediaMissing: false,
      };

      if (!missingSource) {
        media.upsertMediaAsset(newAsset);
        timeline.addClipToTimeline({
          ...newAsset,
          trimIn: 0,
          trimOut: duration * 1000,
          trackType: 'video',
          trackIndex: 1,
          startOffset: 0,
        });
        return;
      }

      // Relink every project reference to the missing source. Timeline
      // placement, track, and start offset are intentionally preserved.
      timeline.setTimelineClips(prev =>
        prev.map(clip => {
          if (normalizePath(clip.filepath) !== oldKey) return clip;

          const oldDurationMs = Number(clip.duration) * 1000;
          const oldTrimIn = Math.max(0, Number(clip.trimIn) || 0);
          const oldTrimOut = Number(clip.trimOut);
          const sourceEndMs = duration * 1000;
          const nextTrimIn = Math.min(oldTrimIn, Math.max(0, sourceEndMs - 1));
          const requestedTrimOut = Number.isFinite(oldTrimOut) && oldTrimOut > 0
            ? oldTrimOut
            : oldDurationMs;
          const nextTrimOut = Math.max(
            nextTrimIn + 1,
            Math.min(requestedTrimOut, sourceEndMs)
          );

          return {
            ...clip,
            filepath,
            filename,
            duration,
            width: w,
            height: h,
            fps,
            aspect,
            trimIn: nextTrimIn,
            trimOut: nextTrimOut,
            mediaMissing: false,
          };
        })
      );

      media.setMediaPoolAndGenerateThumbnails(prev =>
        prev.map(asset =>
          normalizePath(asset.filepath) === oldKey
            ? { ...asset, ...newAsset, id: asset.id, mediaMissing: false }
            : asset
        )
      );

      const sourceNode = graph.nodes.find(node => node.type === 'source');
      if (sourceNode) {
        graph.updateNodeData(sourceNode.id, {
          filepath,
          filename,
          duration,
          width: w,
          height: h,
          fps,
          aspect,
          mediaMissing: false,
          codec: meta.codec || 'unknown',
        });
      }

      console.info('[onDropFileOnSource] Relinked missing source:', {
        from: currentSourcePath,
        to: filepath,
      });
    } catch (e) {
      console.error('[onDropFileOnSource] Probe/relink failed:', e);
    }
  }, [graph, media, timeline]);

  // Inject drop handler + undo/redo into graph nodes
  const nodesWithAllProps = useMemo(() => graph.nodesWithUpdater.map(n => {
    if (n.type === 'source') {
      return {
        ...n,
        data: {
          ...n.data,
          onDropFileOnSource: handleDropFileOnSource,
          onMediaPoolChange: media.setMediaPool,
          setMediaPool: media.setMediaPool,
          setTimelineClips: timeline.setTimelineClips,
          timelineClips: timeline.timelineClips,
          activeClipIndex: timeline.activeClipIndex,
        }
      };
    }
    return n;
  }), [graph.nodesWithUpdater, handleDropFileOnSource, media.setMediaPool, media.setMediaPoolAndGenerateThumbnails, timeline.setTimelineClips, timeline.timelineClips, timeline.activeClipIndex]);

  return (
    <VideoProvider
      filepath={activeFilepath}
      width={activeWidth}
      height={activeHeight}
      clips={timeline.outputClips}
      bgMusic={graph.bgMusicParams}
      onActiveClipChange={timeline.setActiveClipIndex}
      sourceDuration={graph.sourceNode?.data?.duration || 0}
    >
    <div className="akuma-studio-layout">
      {/* ═══ TOP TOOLBAR — Palette + Presets + Project + Export ═══ */}
      <div className="toolbar">
        <span className="toolbar-logo">AKUMAUI</span>
        <div className="toolbar-divider" />

        {/* Node Palette */}
        <div className="toolbar-section node-palette">
          {paletteItems.map((item) => (
            <div
              key={item.type}
              className="palette-item"
              draggable
              onDragStart={(e) => graph.onDragStart(e, item.type)}
              title={`Drag to add ${item.label} node`}
            >
              <span className="palette-dot" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </div>

        {/* Undo/Redo buttons */}
        <div className="toolbar-section undo-redo">
          <button
            className="toolbar-btn"
            onClick={graph.undo}
            disabled={!graph.canUndo}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            className="toolbar-btn"
            onClick={graph.redo}
            disabled={!graph.canRedo}
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          >
            ↪
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Presets */}
        <div className="toolbar-section">
          <button className="toolbar-btn save-preset" onClick={handleSave}>SAVE</button>
          <div className="preset-select-wrapper">
            <select
              className="toolbar-select load-preset"
              defaultValue=""
              onChange={handleSelectPreset}
              title="Load a preset template"
            >
              <option value="" disabled>PRESET...</option>
              {graph.presets.map((preset) => (
                <option key={preset} value={preset}>
                  {preset.replace('.json', '').replace(/_/g, ' ')}
                </option>
              ))}
              <option value="browse">Browse File...</option>
            </select>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* Project Stats */}
        <div className="toolbar-section toolbar-stats">
          <span className="toolbar-stat">1080×1920</span>
          <span className="toolbar-stat">{graph.globalAspect}</span>
          <div className={`gpu-badge ${graph.gpuInfo.available ? 'available' : ''}`}>
            <span className="gpu-dot" />
            {graph.gpuInfo.available ? (graph.gpuInfo.gpuName || 'NVENC') : 'CPU'}
          </div>
        </div>

        <div className="toolbar-spacer" />

        {/* Export */}
        <button className="toolbar-btn export-btn" onClick={() => exportManager.setExportModalOpen(true)}>
          EXPORT
        </button>
      </div>

      {/* ═══ WORKSPACE BODY ═══ */}
      <div className="workspace-body">
        {/* CENTER PANE — Viewer */}
        <div className="center-pane" style={{ width: `${leftPanelWidth}px`, flex: `0 0 ${leftPanelWidth}px`, minWidth: 'unset', maxWidth: 'unset' }}>
          <div className="viewer-container">
            <PreviewPanel nodes={graph.nodes} edges={graph.edges} updateNodeData={graph.updateNodeData} globalAspect={graph.globalAspect} />
          </div>
        </div>

        {/* Draggable divider */}
        <div 
          className={`workspace-divider ${isResizing ? 'active' : ''}`}
          onMouseDown={startResizing}
        />

        {/* RIGHT PANE — Node Graph */}
        <div className="right-pane" ref={reactFlowWrapper} onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodesWithAllProps}
            edges={graph.edgesWithDelete}
            onNodesChange={graph.onNodesChange}
            onEdgesChange={graph.onEdgesChange}
            onConnect={graph.onConnect}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{
              style: { stroke: '#555555', strokeWidth: 1.5 },
              animated: true,
              interactionWidth: 20,
            }}
            edgesFocusable={true}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
            onlyRenderVisibleElements={false}
            elevateNodesOnSelect={false}
          >
            <Controls className="flow-controls" showInteractive={false} />
            <MiniMap
              className="flow-minimap"
              nodeColor={(n) => n.selected ? 'var(--color-accent)' : '#242424'}
              maskColor="rgba(20, 20, 20, 0.8)"
            />
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#222222" />
          </ReactFlow>
        </div>
      </div>

      {/* Gutter Playback Transport Bar */}
      <TransportGutter />

      {/* ═══ BOTTOM — Media Pool & NLE Track Timeline Layout ═══ */}
      <div
        className={`timeline-resize-handle ${isTimelineResizing ? 'active' : ''}`}
        onMouseDown={startTimelineResizing}
        title="Resize timeline"
      />
      <div
        className="timeline-track-container"
        style={{ '--timeline-height': `${timelineHeight}px` }}
      >
        <Timeline
          clips={timeline.sanitizedTimelineClips}
          activeClipIndex={timeline.activeClipIndex}
          onActiveClipChange={timeline.setActiveClipIndex}
          onClipTrimChange={timeline.handleClipTrimChange}
          onClipTrackChange={timeline.handleClipTrackChange}
          onClipStartOffsetChange={timeline.handleClipStartOffsetChange}
          onRemoveClip={timeline.handleRemoveClip}
          onClipsChange={timeline.setTimelineClips}
          duration={timeline.sourceDuration}
          thumbnails={media.thumbnailsCache}
          mediaPool={media.mediaPool}
          onImportMedia={media.handleImportMedia}
          onImportFilePaths={media.importFilePaths}
          onAddFromMediaPool={(asset) => {
            const newClip = media.handleAddFromMediaPool(asset);
            timeline.addClipToTimeline(newClip);
          }}
          onMediaPoolChange={media.setMediaPool}
        />
      </div>

      <MaskEditorModal
        isOpen={graph.maskEditorState.isOpen}
        maskData={graph.maskEditorState.maskData}
        onClose={() => graph.setMaskEditorState({ isOpen: false, nodeId: null, maskData: null })}
        onSave={(newMaskData) => {
          graph.updateNodeData(graph.maskEditorState.nodeId, newMaskData);
        }}
      />

      <ExportModal
        isOpen={exportManager.isExportModalOpen}
        gpuAvailable={graph.gpuInfo.available}
        onClose={() => exportManager.setExportModalOpen(false)}
        onExport={handleExport}
      />
    </div>
    </VideoProvider>
  );
}

// ── App wrapper ───────────────────────────────────────────
function AppInner() {
  return (
    <ReactFlowProvider>
      <FlowEditor />
    </ReactFlowProvider>
  );
}

export default function App() {
  return <AppInner />;
}