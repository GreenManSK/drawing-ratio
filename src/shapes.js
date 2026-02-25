const CANVAS_RES = 700;
const FILL_RATIO = 0.82; // how much of the canvas the shape fills

const ALL_TYPES = ['rectangle', 'ellipse', 'triangle', 'complex', 'complex-rounded'];

export function randomShapeType() {
  return ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)];
}

export function generateRatio(difficulty) {
  let w, h;
  if (difficulty === 'easy') {
    w = Math.floor(Math.random() * 4) + 1;
    h = Math.floor(Math.random() * 4) + 1;
  } else if (difficulty === 'medium') {
    w = Math.floor(Math.random() * 10) + 1;
    h = Math.floor(Math.random() * 10) + 1;
  } else {
    if (Math.random() > 0.5) {
      w = Math.floor(Math.random() * 20) + 1;
      h = Math.floor(Math.random() * 20) + 1;
    } else {
      w = parseFloat((Math.random() * 15 + 1).toFixed(1));
      h = parseFloat((Math.random() * 15 + 1).toFixed(1));
    }
  }
  return { w: parseFloat(w), h: parseFloat(h) };
}

function generateComplexPoints(perimeterPerEdge) {
  const pts = [];
  for (let i = 0; i < perimeterPerEdge; i++) {
    pts.push({ x: Math.random(), y: 0 });
    pts.push({ x: 1, y: Math.random() });
    pts.push({ x: Math.random(), y: 1 });
    pts.push({ x: 0, y: Math.random() });
  }
  const numInterior = Math.floor(Math.random() * 7);
  for (let i = 0; i < numInterior; i++) {
    pts.push({ x: Math.random(), y: Math.random() });
  }

  // Sort by angle from center
  pts.sort((a, b) =>
    Math.atan2(a.y - 0.5, a.x - 0.5) - Math.atan2(b.y - 0.5, b.x - 0.5)
  );

  // Normalize to exactly [0, 1] bounding box
  let minX = Math.min(...pts.map(p => p.x));
  let maxX = Math.max(...pts.map(p => p.x));
  let minY = Math.min(...pts.map(p => p.y));
  let maxY = Math.max(...pts.map(p => p.y));
  const cxA = (minX + maxX) / 2;
  const cyA = (minY + maxY) / 2;
  const sw = maxX - minX || 1;
  const sh = maxY - minY || 1;

  return pts.map(p => ({
    x: (p.x - cxA) / sw + 0.5,
    y: (p.y - cyA) / sh + 0.5,
  }));
}

/**
 * Create a new exercise.
 * @param {string} shapeType - shape type or 'random'
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @returns {{ shapeType: string, ratio: {w: number, h: number}, points: Array|null }}
 */
export function createExercise(shapeType, difficulty) {
  if (shapeType === 'random') shapeType = randomShapeType();
  const ratio = generateRatio(difficulty);
  let points = null;
  if (shapeType === 'complex' || shapeType === 'complex-rounded') {
    points = generateComplexPoints(shapeType === 'complex-rounded' ? 2 : 1);
  }
  return { shapeType, ratio, points };
}

/**
 * Compute the pixel bounding box for an exercise on a CANVAS_RES × CANVAS_RES canvas.
 * @param {{ ratio: {w,h} }} exercise
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function shapeBBox(exercise) {
  const { ratio } = exercise;
  const maxSize = CANVAS_RES * FILL_RATIO;
  const scale = maxSize / Math.max(ratio.w, ratio.h);
  const w = ratio.w * scale;
  const h = ratio.h * scale;
  const x = (CANVAS_RES - w) / 2;
  const y = (CANVAS_RES - h) / 2;
  return { x, y, w, h };
}

function drawPath(ctx, exercise, x, y, w, h) {
  const { shapeType, points } = exercise;
  ctx.beginPath();
  if (shapeType === 'rectangle') {
    ctx.rect(x, y, w, h);
  } else if (shapeType === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shapeType === 'triangle') {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  } else if ((shapeType === 'complex' || shapeType === 'complex-rounded') && points) {
    const mapped = points.map(p => ({ x: x + p.x * w, y: y + p.y * h }));
    if (shapeType === 'complex-rounded') {
      const lp = mapped[mapped.length - 1];
      ctx.moveTo((lp.x + mapped[0].x) / 2, (lp.y + mapped[0].y) / 2);
      for (let i = 0; i < mapped.length; i++) {
        const cur = mapped[i];
        const nxt = mapped[(i + 1) % mapped.length];
        ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
      }
    } else {
      ctx.moveTo(mapped[0].x, mapped[0].y);
      for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
    }
    ctx.closePath();
  }
}

/**
 * Render the reference shape (filled) onto ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} exercise
 * @returns {{ x, y, w, h }} - pixel bounding box used
 */
export function renderShape(ctx, exercise) {
  ctx.clearRect(0, 0, CANVAS_RES, CANVAS_RES);
  const bb = shapeBBox(exercise);
  ctx.fillStyle = '#667eea';
  ctx.strokeStyle = '#4c5ebd';
  ctx.lineWidth = 2;
  drawPath(ctx, exercise, bb.x, bb.y, bb.w, bb.h);
  ctx.fill();
  ctx.stroke();
  return bb;
}

/**
 * Render the shape as a dashed outline for overlaying on the drawing canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} exercise
 * @param {number} x  - where to position it (canvas coords)
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} [strokeColor]
 * @param {string} [fillColor]
 */
/**
 * Render the shape filled at exact position/size (non-uniform scale allowed).
 * Used for the shape-overlap analysis on offscreen canvases.
 */
export function renderShapeFilled(ctx, exercise, x, y, w, h, fillColor = 'black') {
  ctx.save();
  ctx.fillStyle = fillColor;
  drawPath(ctx, exercise, x, y, w, h);
  ctx.fill();
  ctx.restore();
}

export function renderShapeOutline(ctx, exercise, x, y, w, h, strokeColor = '#667eea', fillColor = 'rgba(102,126,234,0.07)') {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.lineCap = 'round';
  drawPath(ctx, exercise, x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
