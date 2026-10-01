const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const { detectNvidiaGpu, runExport, cancelExport } = require('./ffmpegEngine');

// Force high-performance GPU & hardware rendering switches
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0a0a10',
    titleBarStyle: 'hiddenInset',
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

const fs = require('fs');

// MIME type lookup for media files
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

app.whenReady().then(() => {
  // Register custom media protocol with HTTP range request support (streaming)
  protocol.handle('media', (request) => {
    let rawPath = request.url.replace('media:///', '');
    rawPath = decodeURIComponent(rawPath);
    const filePath = rawPath.replace(/\//g, path.sep);

    console.log('[media://] Serving:', filePath);

    try {
      if (!fs.existsSync(filePath)) {
        console.error('[media://] File not found:', filePath);
        return new Response('Not found', { status: 404 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        // HTTP 206 Partial Content — stream only the requested byte range
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!match) {
          return new Response('Bad range', { status: 416 });
        }
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(chunkSize),
            'Accept-Ranges': 'bytes',
          },
        });
      }

      // Full file — stream instead of readFileSync to prevent OOM
      const stream = fs.createReadStream(filePath);
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[media://] Error:', err.message);
      return new Response('Server error', { status: 500 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  cancelExport(); // Kill any running FFmpeg process
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cancelExport(); // Safety net: kill FFmpeg on quit
});

// ── IPC Handlers ──────────────────────────────────────────
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Video File',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Video File(s)',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:saveFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Video',
    defaultPath: 'output.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('ffmpeg:checkGpu', async () => {
  return detectNvidiaGpu();
});

ipcMain.handle('ffmpeg:export', async (_event, config) => {
  try {
    const result = await runExport(config, (progress) => {
      mainWindow.webContents.send('ffmpeg:progress', progress);
    });
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ffmpeg:cancel', async () => {
  return { cancelled: cancelExport() };
});

// ── Probe Result Cache (keyed by filepath + mtime) ────────────
const probeCache = new Map();
const PROBE_CACHE_MAX = 50;

function getCachedProbe(filepath) {
  try {
    const stat = fs.statSync(filepath);
    const key = `${filepath}::${stat.mtimeMs}`;
    return probeCache.get(key) || null;
  } catch { return null; }
}

function setCachedProbe(filepath, result) {
  if (probeCache.size >= PROBE_CACHE_MAX) {
    const firstKey = probeCache.keys().next().value;
    probeCache.delete(firstKey);
  }
  try {
    const stat = fs.statSync(filepath);
    const key = `${filepath}::${stat.mtimeMs}`;
    probeCache.set(key, result);
  } catch {}
}

// Probe video metadata (duration, resolution, fps) — async to avoid blocking main process
ipcMain.handle('ffmpeg:probe', async (_event, filepath) => {
  const { execFile } = require('child_process');

  // Return cached result if available
  const cached = getCachedProbe(filepath);
  if (cached) {
    console.log('[probe] Cache hit:', filepath);
    return cached;
  }

  // Validate file exists before attempting to probe
  if (!fs.existsSync(filepath)) {
    console.error('[probe] File not found:', filepath);
    return { duration: 0, width: 1920, height: 1080, fps: 60, codec: 'unknown' };
  }

  const FFPROBE_PATHS = [
    'ffprobe',
    'C:\\Program Files\\Shutter Encoder\\Library\\ffprobe.exe',
    'C:\\Program Files (x86)\\YouTube Playlist Downloader\\ffprobe.exe',
  ];
  const FFMPEG_PATHS = [
    'ffmpeg',
    'C:\\Program Files\\Shutter Encoder\\Library\\ffmpeg.exe',
    'C:\\Program Files (x86)\\YouTube Playlist Downloader\\ffmpeg.exe',
  ];

  // Helper: run a command async and return stdout/stderr
  const runAsync = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr) reject(err);
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });

  // Try ffprobe first (async)
  for (const probe of FFPROBE_PATHS) {
    try {
      const { stdout } = await runAsync(probe, [
        '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filepath,
      ]);
      const data = JSON.parse(stdout);
      const videoStream = data.streams?.find(s => s.codec_type === 'video');
      const duration = parseFloat(data.format?.duration || videoStream?.duration || 0);
      const width = videoStream?.width || 1920;
      const height = videoStream?.height || 1080;

      let fps = 60;
      if (videoStream?.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/');
        if (den && parseInt(den) > 0) fps = Math.round(parseInt(num) / parseInt(den));
      }

      const codec = videoStream?.codec_name || 'unknown';

      console.log(`[probe] Success via ${probe}: ${width}x${height}, ${duration}s, ${fps}fps, codec=${codec}`);
      return { duration, width, height, fps, codec };
    } catch (e) {
      continue;
    }
  }

  // Fallback: parse ffmpeg -i stderr (async)
  for (const ff of FFMPEG_PATHS) {
    try {
      const { stderr: output } = await runAsync(ff, ['-i', filepath]);

      let duration = 0, width = 1920, height = 1080, fps = 60;

      const durMatch = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.?\d*)/);
      if (durMatch) {
        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
      }

      const resMatch = output.match(/(\d{2,5})x(\d{2,5})/);
      if (resMatch) {
        width = parseInt(resMatch[1]);
        height = parseInt(resMatch[2]);
      }

      const fpsMatch = output.match(/(\d+(?:\.\d+)?)\s*fps/);
      if (fpsMatch) fps = Math.round(parseFloat(fpsMatch[1]));

      const codecMatch = output.match(/Video:\s*(\w+)/);
      const codec = codecMatch ? codecMatch[1].toLowerCase() : 'unknown';

      console.log(`[probe] Fallback via ${ff}: ${width}x${height}, ${duration}s, ${fps}fps, codec=${codec}`);
      return { duration, width, height, fps, codec };
    } catch (e) {
      continue;
    }
  }

  console.error('[probe] All methods failed');
  const fallback = { duration: 0, width: 1920, height: 1080, fps: 60, codec: 'unknown' };
  setCachedProbe(filepath, fallback);
  return fallback;
});

// ── Presets Handlers ──────────────────────────────────────
ipcMain.handle('get-presets', async () => {
  const list = new Set();
  
  // 1. Check process.cwd() / presets
  const localDir = path.join(process.cwd(), 'presets');
  if (fs.existsSync(localDir)) {
    try {
      fs.readdirSync(localDir).filter(f => f.endsWith('.json')).forEach(f => list.add(f));
    } catch (e) {}
  }
  
  // 2. Check userData / presets
  const userDir = path.join(app.getPath('userData'), 'presets');
  if (!fs.existsSync(userDir)) {
    try { fs.mkdirSync(userDir, { recursive: true }); } catch (e) {}
  }
  if (fs.existsSync(userDir)) {
    try {
      fs.readdirSync(userDir).filter(f => f.endsWith('.json')).forEach(f => list.add(f));
    } catch (e) {}
  }
  
  // If list is empty, let's create a default template in userDir
  if (list.size === 0 && fs.existsSync(userDir)) {
    const defaultTemplate = {
      nodes: [
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
      ],
      edges: [
        {
          id: 'e-source-crop',
          source: 'source-1',
          target: 'crop-1',
          type: 'default',
          animated: true,
          style: { stroke: '#e8a838', strokeWidth: 2.5 },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    try {
      fs.writeFileSync(path.join(userDir, 'Default_Split.json'), JSON.stringify(defaultTemplate, null, 2));
      list.add('Default_Split.json');
    } catch (e) {}
  }
  
  return Array.from(list);
});

ipcMain.handle('load-preset', async (_event, filename) => {
  // Try loading from local presets directory first
  const localDir = path.join(process.cwd(), 'presets');
  const localPath = path.join(localDir, filename);
  if (fs.existsSync(localPath)) {
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {}
  }
  
  // Try loading from user presets directory
  const userDir = path.join(app.getPath('userData'), 'presets');
  const userPath = path.join(userDir, filename);
  if (fs.existsSync(userPath)) {
    try {
      const content = fs.readFileSync(userPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {}
  }
  
  return null;
});
