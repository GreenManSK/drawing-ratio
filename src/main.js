import '../styles/main.css';
import { createExercise, renderShape, renderShapeOutline } from './shapes.js';
import { DrawingCanvas } from './drawing.js';
import { analyzeDrawing, computeShapeOverlap, scoreClass } from './analysis.js';

const CANVAS_RES = 700;

// ── Canvas setup ───────────────────────────────────────────────────────
const refCanvas  = document.getElementById('refCanvas');
const drawCanvas = document.getElementById('drawCanvas');
const refCtx     = refCanvas.getContext('2d');

refCanvas.width  = CANVAS_RES;
refCanvas.height = CANVAS_RES;
drawCanvas.width  = CANVAS_RES;
drawCanvas.height = CANVAS_RES;

const dc = new DrawingCanvas(drawCanvas);

// ── State ──────────────────────────────────────────────────────────────
let exercise = null;
let refBBox  = null;   // pixel bbox returned by renderShape (700-space)

// ── Generate ───────────────────────────────────────────────────────────
function generate() {
  exercise = createExercise(
    document.getElementById('shapeType').value,
    document.getElementById('difficulty').value,
  );
  refBBox = renderShape(refCtx, exercise);

  // Reset ratio reveal
  const rd = document.getElementById('ratioDisplay');
  rd.textContent = '';
  document.getElementById('revealBtn').style.display = '';

  // Clear drawing and reset scores
  dc.clear();
  resetScores();
}

// ── Ratio reveal ───────────────────────────────────────────────────────
function revealRatio() {
  if (!exercise) return;
  const { w, h } = exercise.ratio;
  const rd = document.getElementById('ratioDisplay');
  rd.textContent = `${w} : ${h}  (${(w / h).toFixed(3)})`;
  document.getElementById('revealBtn').style.display = 'none';
}

// ── Analyze ────────────────────────────────────────────────────────────
function analyze() {
  if (!exercise || dc.isEmpty()) return;
  const drawn = dc.getBoundingBox();
  if (!drawn || drawn.w < 5 || drawn.h < 5) return;

  const result = analyzeDrawing(drawn, refBBox);
  const { shapeScore, shapeDetail } = computeShapeOverlap(
    exercise, refBBox, drawn, dc.getStrokes()
  );
  // Recompute overall incorporating all three scores (ratio 40%, size 25%, shape 35%)
  const overallScore = Math.max(0, Math.min(100, Math.round(
    result.ratioScore * 0.40 + result.sizeScore * 0.25 + shapeScore * 0.35
  )));
  showScores({ ...result, shapeScore, shapeDetail, overallScore });
  revealRatio();

  // Overlay: target shape centered on drawn bbox + drawn bbox rect + legend
  const ox = drawn.cx - refBBox.w / 2;
  const oy = drawn.cy - refBBox.h / 2;

  dc.setOverlay(ctx => {
    renderShapeOutline(ctx, exercise, ox, oy, refBBox.w, refBBox.h);

    // Drawn bounding box in red
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(drawn.minX, drawn.minY, drawn.w, drawn.h);
    ctx.restore();

    drawLegend(ctx);
  });
}

function drawLegend(ctx) {
  ctx.save();
  ctx.font = '11px Segoe UI, system-ui, sans-serif';
  const lx = 10, by = CANVAS_RES - 10;

  // "target" — blue solid-ish dashes
  ctx.strokeStyle = '#667eea';
  ctx.lineWidth   = 2;
  ctx.setLineDash([6, 4]);
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(lx, by - 14); ctx.lineTo(lx + 18, by - 14);
  ctx.stroke();
  ctx.fillStyle = '#4c5ebd';
  ctx.fillText('target', lx + 22, by - 10);

  // "drawn area" — red shorter dashes
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(lx, by); ctx.lineTo(lx + 18, by);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.fillText('drawn area', lx + 22, by + 4);

  ctx.restore();
}

// ── Score display ──────────────────────────────────────────────────────
function showScores({ ratioScore, sizeScore, shapeScore, overallScore, ratioDetail, sizeDetail, shapeDetail, hint }) {
  setBar('ratioFill', 'ratioVal', ratioScore);
  setBar('sizeFill',  'sizeVal',  sizeScore);
  setBar('shapeFill', 'shapeVal', shapeScore);
  document.getElementById('ratioDetail').textContent  = ratioDetail;
  document.getElementById('sizeDetail').textContent   = sizeDetail;
  document.getElementById('shapeDetail').textContent  = shapeDetail;
  const el = document.getElementById('overallVal');
  el.textContent = overallScore + '%';
  el.className   = `score-overall__val col-${scoreClass(overallScore)}`;
  document.getElementById('scoreHint').textContent = hint;
}

function resetScores() {
  for (const id of ['ratioFill', 'sizeFill', 'shapeFill']) {
    const el = document.getElementById(id);
    el.style.width = '0%';
    el.className   = 'score-bar__fill';
  }
  for (const id of ['ratioVal', 'sizeVal', 'shapeVal']) {
    const el = document.getElementById(id);
    el.textContent = '—';
    el.className   = 'score-val';
  }
  const ov = document.getElementById('overallVal');
  ov.textContent = '—';
  ov.className   = 'score-overall__val';
  document.getElementById('ratioDetail').textContent  = '';
  document.getElementById('sizeDetail').textContent   = '';
  document.getElementById('shapeDetail').textContent  = '';
  document.getElementById('scoreHint').textContent    = 'Draw the shape, then click Analyze.';
}

function setBar(fillId, valId, score) {
  const cls  = scoreClass(score);
  const fill = document.getElementById(fillId);
  fill.style.width = score + '%';
  fill.className   = `score-bar__fill fill-${cls}`;
  const val  = document.getElementById(valId);
  val.textContent  = score + '%';
  val.className    = `score-val col-${cls}`;
}

// ── Controls ───────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', generate);
document.getElementById('revealBtn').addEventListener('click', revealRatio);
document.getElementById('analyzeBtn').addEventListener('click', analyze);

document.getElementById('brushSize').addEventListener('input', e => {
  dc.setBrushSize(e.target.value);
});

document.getElementById('undoBtn').addEventListener('click', () => dc.undo());

document.getElementById('clearBtn').addEventListener('click', () => {
  dc.clear();
  resetScores();
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault(); dc.undo();
  } else if (e.key === 'Delete' || e.key === 'Escape') {
    dc.clear(); resetScores();
  } else if (e.key === 'Enter') {
    e.preventDefault(); analyze();
  } else if (e.key === ' ') {
    e.preventDefault(); generate();
  }
});

// ── Fullscreen ─────────────────────────────────────────────────────────
const fullscreenBtn = document.getElementById('fullscreenBtn');

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  const full = !!document.fullscreenElement;
  fullscreenBtn.textContent = full ? '⊡' : '⛶';
  fullscreenBtn.title = full ? 'Exit fullscreen' : 'Enter fullscreen';
});

// ── Init ───────────────────────────────────────────────────────────────
generate();
