import { drawShapePath } from './canvas';

export function computeLayerGeometry(layer, canvasW, canvasH) {
  const sourceW = layer?.source?.width || 1920;
  const sourceBounds = layer?.sourceBounds || { x: 0, y: 0, w: sourceW, h: 1080 };
  const scaleX = (layer?.transformScale?.x ?? layer?.transform?.scaleX ?? 100) / 100;
  const scaleY = (layer?.transformScale?.y ?? layer?.transform?.scaleY ?? 100) / 100;
  const previewScale = canvasW / sourceW;
  const w = Math.max(1, sourceBounds.w * previewScale * scaleX);
  const h = Math.max(1, sourceBounds.h * previewScale * scaleY);
  const posX = layer?.transformPos?.x ?? layer?.transform?.posX ?? 50;
  const posY = layer?.transformPos?.y ?? layer?.transform?.posY ?? 50;
  const x = (canvasW - w) * (posX / 100);
  const y = (canvasH - h) * (posY / 100);

  return {
    x,
    y,
    w,
    h,
    rotation: layer?.transform?.rotation || 0,
    crop: {
      x: sourceBounds.x,
      y: sourceBounds.y,
      width: sourceBounds.w,
      height: sourceBounds.h,
    },
  };
}

export function applyLayerClipPath(ctx, layer, destW, destH) {
  const bounds = layer?.sourceBounds || { w: 1, h: 1 };
  const shapes = layer?.localMaskRects || [];
  const scaleX = destW / bounds.w;
  const scaleY = destH / bounds.h;

  ctx.beginPath();

  if (layer?.subtractMode) {
    ctx.rect(0, 0, destW, destH);
    for (const shape of shapes) {
      drawShapePath(ctx, shape, scaleX, scaleY, true);
    }
    return;
  }

  if (shapes.length === 0) {
    ctx.rect(0, 0, destW, destH);
    return;
  }

  for (const shape of shapes) {
    drawShapePath(ctx, shape, scaleX, scaleY);
  }
}


export function drawBaseVideo(ctx, video, canvasW, canvasH, opacity = 1) {
  const vw = video?.videoWidth || 1920;
  const vh = video?.videoHeight || 1080;
  const srcAspect = vw / vh;
  const dstAspect = canvasW / canvasH;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (srcAspect > dstAspect) {
    sw = vh * dstAspect;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / dstAspect;
    sy = (vh - sh) / 2;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
  ctx.restore();
}

export function drawLayerToCanvas(ctx, video, layer, canvasW, canvasH, options = {}) {
  const geo = computeLayerGeometry(layer, canvasW, canvasH);
  const crop = geo.crop;
  const debugStroke = options.debugStroke;

  ctx.save();
  ctx.translate(geo.x + geo.w / 2, geo.y + geo.h / 2);
  ctx.rotate((geo.rotation * Math.PI) / 180);
  ctx.translate(-geo.w / 2, -geo.h / 2);

  ctx.save();
  if (layer.cropBounds) {
    const scaleX = geo.w / (layer.sourceBounds.w || 1);
    const scaleY = geo.h / (layer.sourceBounds.h || 1);
    const cropX = (layer.cropBounds.x - layer.sourceBounds.x) * scaleX;
    const cropY = (layer.cropBounds.y - layer.sourceBounds.y) * scaleY;
    const cropW = (layer.cropBounds.width ?? layer.cropBounds.w) * scaleX;
    const cropH = (layer.cropBounds.height ?? layer.cropBounds.h) * scaleY;
    ctx.rect(cropX, cropY, cropW, cropH);
    ctx.clip();
  }
  applyLayerClipPath(ctx, layer, geo.w, geo.h);
  ctx.clip();
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, geo.w, geo.h);
  ctx.restore();

  if (debugStroke) {
    ctx.strokeStyle = debugStroke;
    ctx.lineWidth = options.debugLineWidth || 1;
    ctx.setLineDash(options.debugDash || []);
    ctx.strokeRect(0, 0, geo.w, geo.h);
    ctx.setLineDash([]);
  }

  ctx.restore();
  return geo;
}

export function drawComposition(ctx, video, layers, canvasW, canvasH, options = {}) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = options.background || '#0a0a10';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (!video) return;

  drawBaseVideo(ctx, video, canvasW, canvasH, options.baseOpacity ?? 1);
  for (const layer of layers || []) {
    drawLayerToCanvas(ctx, video, layer, canvasW, canvasH, options.layerOptions || {});
  }
}
