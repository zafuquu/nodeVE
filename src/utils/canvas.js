/**
 * Shared canvas shape drawing utilities for ClipForge (P2-2)
 */

/**
 * Draws shape path (rectangle/ellipse/rounded-rect) onto a canvas context.
 * Standardizes coords logic, supporting both {w, h} and {width, height} specs.
 */
export function drawShapePath(ctx, shape, sx, sy, reverse = false) {
  const x = shape.x * sx;
  const y = shape.y * sy;
  const w = (shape.w ?? shape.width ?? 0) * sx;
  const h = (shape.h ?? shape.height ?? 0) * sy;

  if (shape.type === 'ellipse') {
    ctx.ellipse(
      x + w / 2,
      y + h / 2,
      Math.abs(w / 2),
      Math.abs(h / 2),
      0,
      0,
      Math.PI * 2,
      reverse
    );
    return;
  }

  const r = Math.min((shape.roundness || 0) * Math.min(sx, sy), Math.abs(w) / 2, Math.abs(h) / 2);
  if (r > 0) {
    if (reverse) {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.closePath();
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  } else {
    if (reverse) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
  }
}
