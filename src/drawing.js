const CANVAS_RES = 700;
const GRID_SPACING = 25;

export class DrawingCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];      // Array of { points: [{x, y, pressure}] }
    this.currentStroke = null;
    this.brushSize = 3;
    this.isDrawing = false;
    this._overlayFn = null;
    this._rafId = null;

    this._bindEvents();
    this._redraw();
  }

  setBrushSize(size) {
    this.brushSize = Number(size);
  }

  // ── Event binding ──────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown',   this._onDown.bind(this));
    c.addEventListener('pointermove',   this._onMove.bind(this));
    c.addEventListener('pointerup',     this._onUp.bind(this));
    c.addEventListener('pointercancel', this._onUp.bind(this));
    c.addEventListener('contextmenu', e => e.preventDefault());
    // Prevent touch scroll while drawing
    c.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }

  _toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = CANVAS_RES / rect.width;
    const scaleY = CANVAS_RES / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
      // pressure: 0 for mouse hover (not pressing), 0.5 for mouse button,
      // 0..1 for pen pressure. Normalise so mouse always gives ~0.5
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  _onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.isDrawing = true;
    this._overlayFn = null;   // clear overlay when user starts drawing
    this.canvas.classList.add('is-drawing');
    const pt = this._toCanvas(e);
    this.currentStroke = { points: [pt] };
    this._scheduleRedraw();
  }

  _onMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      this.currentStroke.points.push(this._toCanvas(ev));
    }
    this._scheduleRedraw();
  }

  _onUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.canvas.classList.remove('is-drawing');
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      this.strokes.push(this.currentStroke);
    }
    this.currentStroke = null;
    this._scheduleRedraw();
  }

  // ── Rendering ─────────────────────────────────────────────────────

  _scheduleRedraw() {
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._redraw();
      });
    }
  }

  _drawGrid() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#dde1ee';
    for (let x = GRID_SPACING; x < CANVAS_RES; x += GRID_SPACING) {
      for (let y = GRID_SPACING; y < CANVAS_RES; y += GRID_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawStroke(stroke) {
    const { ctx, brushSize } = this;
    const { points } = stroke;
    if (points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';

    if (points.length === 1) {
      const r = brushSize * points[0].pressure;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    } else {
      for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        ctx.beginPath();
        ctx.lineWidth = brushSize * ((p0.pressure + p1.pressure) / 2) * 2;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _redraw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_RES, CANVAS_RES);

    // White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, CANVAS_RES, CANVAS_RES);

    this._drawGrid();

    for (const stroke of this.strokes) this._drawStroke(stroke);
    if (this.currentStroke) this._drawStroke(this.currentStroke);

    if (this._overlayFn) this._overlayFn(ctx);
  }

  // ── Public API ────────────────────────────────────────────────────

  clear() {
    this.strokes = [];
    this.currentStroke = null;
    this._overlayFn = null;
    this._scheduleRedraw();
  }

  undo() {
    if (this.strokes.length > 0) {
      this.strokes.pop();
      this._scheduleRedraw();
    }
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  /**
   * Get the bounding box of all drawn strokes in canvas coordinates.
   * Returns null if nothing has been drawn.
   * @returns {{ minX, maxX, minY, maxY, w, h, cx, cy } | null}
   */
  getBoundingBox() {
    if (this.strokes.length === 0) return null;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const stroke of this.strokes) {
      for (const pt of stroke.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    return {
      minX, maxX, minY, maxY,
      w:  maxX - minX,
      h:  maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }

  /** Return a snapshot of all strokes (used for shape-overlap analysis). */
  getStrokes() {
    return this.strokes.map(s => ({ points: s.points.slice() }));
  }

  /**
   * Set a function to be called during redraw to draw an overlay.
   * @param {((ctx: CanvasRenderingContext2D) => void) | null} fn
   */
  setOverlay(fn) {
    this._overlayFn = fn;
    this._scheduleRedraw();
  }
}
