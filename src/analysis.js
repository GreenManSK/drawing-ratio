/**
 * Analyse a freehand drawing against the reference shape.
 *
 * All dimensions are in canvas-internal pixels (0–700 space).
 *
 * @param {{ w: number, h: number }} drawnBBox  - bounding box of drawn strokes
 * @param {{ w: number, h: number }} refBBox    - bounding box from renderShape()
 * @returns {{ ratioScore, sizeScore, overallScore, ratioDetail, sizeDetail, hint }}
 */
export function analyzeDrawing(drawnBBox, refBBox) {
  const drawnRatio  = drawnBBox.w / drawnBBox.h;
  const targetRatio = refBBox.w   / refBBox.h;

  // Ratio score: 0–100
  // 0% diff → 100 pts; 100% diff → 0 pts
  const ratioDiff  = Math.abs(drawnRatio - targetRatio) / targetRatio;
  const ratioScore = clamp(Math.round(100 * (1 - ratioDiff)));

  // Size score: compare largest dimension of drawn vs reference
  const drawnMax = Math.max(drawnBBox.w, drawnBBox.h);
  const refMax   = Math.max(refBBox.w,   refBBox.h);
  const sizeDiff  = Math.abs(drawnMax - refMax) / refMax;
  const sizeScore = clamp(Math.round(100 * (1 - sizeDiff)));

  // Overall (ratio weighted more, since that's the core exercise)
  const overallScore = clamp(Math.round(ratioScore * 0.6 + sizeScore * 0.4));

  const ratioDetail = describeRatio(drawnRatio, targetRatio);
  const sizeDetail  = describeSize(drawnMax, refMax);
  const hint        = makeHint(ratioScore, sizeScore, drawnRatio, targetRatio, drawnMax, refMax);

  return { ratioScore, sizeScore, overallScore, ratioDetail, sizeDetail, hint };
}

// ── Shape overlap (pixel IoU) ──────────────────────────────────────────

const OV_SIZE = 200; // offscreen canvas resolution
const OV_PAD  = 20;  // border padding guarantees exterior seed pixels
const OV_FILL = OV_SIZE - 2 * OV_PAD; // 160 – max usable span

/**
 * Compare the reference shape with the user's freehand drawing using pixel IoU.
 *
 * BOTH shapes are rendered at the SAME scale (derived from the reference size)
 * and centered in the offscreen canvas.  This means a drawing that is the wrong
 * size OR the wrong shape will produce a lower score — deliberately incorporating
 * size and ratio into the comparison rather than normalising them away.
 *
 * @param {object}                    exercise   - current exercise
 * @param {{ x,y,w,h }}               refBBox    - reference bbox in 700-space
 * @param {{ minX,minY,cx,cy,w,h }}   drawnBBox  - drawn strokes bbox
 * @param {Array}                     strokes    - from DrawingCanvas.getStrokes()
 * @returns {{ shapeScore: number, shapeDetail: string }}
 */
export function computeShapeOverlap(exercise, refBBox, drawnBBox, strokes) {
  // One shared scale: fit the reference's largest dimension inside OV_FILL.
  // The user's drawing is rendered at this SAME scale so that size differences
  // are preserved — a small drawing stays small against a big reference.
  const refScale = OV_FILL / Math.max(refBBox.w, refBBox.h);
  const half     = OV_SIZE / 2;

  // ── Canvas A: reference shape (uniform scale, centred) ───────────────
  const canvA = new OffscreenCanvas(OV_SIZE, OV_SIZE);
  const ctxA  = canvA.getContext('2d');
  ctxA.fillStyle = 'white';
  ctxA.fillRect(0, 0, OV_SIZE, OV_SIZE);

  const rw = refBBox.w * refScale;
  const rh = refBBox.h * refScale;
  _renderFilledNorm(ctxA, exercise, half - rw / 2, half - rh / 2, rw, rh);

  // ── Canvas B: user strokes (same scale, centred on drawn bbox) ───────
  const canvB = new OffscreenCanvas(OV_SIZE, OV_SIZE);
  const ctxB  = canvB.getContext('2d');
  ctxB.fillStyle = 'white';
  ctxB.fillRect(0, 0, OV_SIZE, OV_SIZE);

  // Translate so the drawn bounding-box centre lands at canvas centre.
  const dtx = half - drawnBBox.cx * refScale;
  const dty = half - drawnBBox.cy * refScale;

  ctxB.strokeStyle = 'black';
  ctxB.fillStyle   = 'black';
  ctxB.lineWidth   = 4; // fixed thickness helps flood-fill close small gaps
  ctxB.lineCap     = 'round';
  ctxB.lineJoin    = 'round';

  for (const stroke of strokes) {
    const pts = stroke.points;
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      ctxB.beginPath();
      ctxB.arc(pts[0].x * refScale + dtx, pts[0].y * refScale + dty, 2, 0, Math.PI * 2);
      ctxB.fill();
      continue;
    }
    ctxB.beginPath();
    ctxB.moveTo(pts[0].x * refScale + dtx, pts[0].y * refScale + dty);
    for (let i = 1; i < pts.length; i++) {
      ctxB.lineTo(pts[i].x * refScale + dtx, pts[i].y * refScale + dty);
    }
    ctxB.stroke();
  }

  // ── Pixel IoU ────────────────────────────────────────────────────────
  const imgA = ctxA.getImageData(0, 0, OV_SIZE, OV_SIZE);
  const imgB = ctxB.getImageData(0, 0, OV_SIZE, OV_SIZE);

  // BFS from all border pixels — stops at dark stroke pixels.
  // exterior[i]=1: background pixel reachable from outside the drawing.
  // !exterior[i] (and not a stroke): enclosed interior of the drawn shape.
  const exterior = _floodFillExterior(imgB.data, OV_SIZE, OV_SIZE);

  let intersection = 0, union = 0;
  const dA = imgA.data, dB = imgB.data;
  for (let i = 0; i < OV_SIZE * OV_SIZE; i++) {
    const inRef   = dA[i * 4] < 64;
    const inDrawn = dB[i * 4] < 64 || !exterior[i];
    if (inRef && inDrawn) intersection++;
    if (inRef || inDrawn) union++;
  }

  const shapeScore  = union === 0 ? 0 : clamp(Math.round(100 * intersection / union));
  const shapeDetail = shapeScore >= 85 ? 'good match'
                    : shapeScore >= 60 ? 'some deviation'
                    : 'shape mismatch';

  return { shapeScore, shapeDetail };
}

// Render shape filled at exactly (x,y,w,h) — mirrors drawPath in shapes.js
// (duplicated here to keep analysis.js self-contained for the offscreen render)
function _renderFilledNorm(ctx, exercise, x, y, w, h) {
  const { shapeType, points } = exercise;
  ctx.fillStyle = 'black';
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
        const cur = mapped[i], nxt = mapped[(i + 1) % mapped.length];
        ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
      }
    } else {
      ctx.moveTo(mapped[0].x, mapped[0].y);
      for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
    }
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * BFS from all canvas border pixels outward, stopping at dark stroke pixels.
 * Returns a Uint8Array where 1 = exterior background, 0 = stroke or enclosed interior.
 */
function _floodFillExterior(data, w, h) {
  const n        = w * h;
  const exterior = new Uint8Array(n);
  const queue    = [];
  let   head     = 0;

  function enqueue(idx) {
    if (!exterior[idx] && data[idx * 4] >= 64) { // not already seen, not a stroke
      exterior[idx] = 1;
      queue.push(idx);
    }
  }

  // Seed all four border edges
  for (let x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { enqueue(y * w); enqueue(y * w + w - 1); }

  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0)   enqueue(idx - 1);
    if (x < w-1) enqueue(idx + 1);
    if (y > 0)   enqueue(idx - w);
    if (y < h-1) enqueue(idx + w);
  }

  return exterior;
}

/** Map a 0–100 score to a CSS colour class suffix. */
export function scoreClass(n) {
  if (n >= 85) return 'ex';
  if (n >= 70) return 'good';
  if (n >= 50) return 'ok';
  return 'poor';
}

// ── Helpers ────────────────────────────────────────────────────────────

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

function describeRatio(drawn, target) {
  const pct = Math.abs(((drawn - target) / target) * 100);
  if (pct < 3)  return 'spot on';
  if (drawn > target) return `${pct.toFixed(0)}% too wide`;
  return `${pct.toFixed(0)}% too tall`;
}

function describeSize(drawn, ref) {
  const pct = Math.abs(((drawn - ref) / ref) * 100);
  if (pct < 5)  return 'spot on';
  if (drawn > ref) return `${pct.toFixed(0)}% too large`;
  return `${pct.toFixed(0)}% too small`;
}

function makeHint(ratioScore, sizeScore, drawnRatio, targetRatio, drawnDim, refDim) {
  if (ratioScore >= 85 && sizeScore >= 85) return '🎉 Both ratio and size are spot on!';

  const parts = [];
  if (ratioScore < 85) {
    parts.push(drawnRatio > targetRatio ? 'make it narrower (or taller)' : 'make it wider (or shorter)');
  }
  if (sizeScore < 70) {
    parts.push(drawnDim > refDim ? 'draw it smaller' : 'draw it larger');
  }

  return parts.length ? parts.join(' · ') : '👍 Good – keep practising!';
}
