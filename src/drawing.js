const CANVAS_RES = 700;
const GRID_SPACING = 25;

const DEFAULT_PEN_SIZE    = 3;
const DEFAULT_ERASER_SIZE = 15;
const LS_PEN_KEY    = 'dr-pen-size';
const LS_ERASER_KEY = 'dr-eraser-size';

export class DrawingCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.strokes = []; // Array of { points: [{x, y, pressure}], isEraser, brushSize }
    this.currentStroke = null;
    this.mode = "pen";
    this.penSize    = Number(localStorage.getItem(LS_PEN_KEY))    || DEFAULT_PEN_SIZE;
    this.eraserSize = Number(localStorage.getItem(LS_ERASER_KEY)) || DEFAULT_ERASER_SIZE;
    this.isDrawing = false;
    this._activePointerId = null; // for palm rejection: lock to first accepted pointer
    this._overlayFn = null;
    this._rafId = null;

    this._bindEvents();
    this._redraw();
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.classList.toggle("is-erasing", mode === "eraser");
  }

  getBrushSize() {
    return this.mode === "pen" ? this.penSize : this.eraserSize;
  }

  setBrushSize(size) {
    if (this.mode === 'pen') {
      this.penSize = Number(size);
      localStorage.setItem(LS_PEN_KEY, this.penSize);
    } else {
      this.eraserSize = Number(size);
      localStorage.setItem(LS_ERASER_KEY, this.eraserSize);
    }
  }

  // ── Event binding ──────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this._onDown.bind(this));
    c.addEventListener("pointermove", this._onMove.bind(this));
    c.addEventListener("pointerup", this._onUp.bind(this));
    c.addEventListener("pointercancel", this._onUp.bind(this));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    // Prevent touch scroll while drawing
    c.addEventListener("touchstart", (e) => e.preventDefault(), {
      passive: false,
    });
  }

  _toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = CANVAS_RES / rect.width;
    const scaleY = CANVAS_RES / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      // pressure: 0 for mouse hover (not pressing), 0.5 for mouse button,
      // 0..1 for pen pressure. Normalise so mouse always gives ~0.5
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  _isPalmRejected(e) {
    // If a pen pointer is active, reject any subsequent touch (palm)
    if (this.isDrawing && e.pointerType === "touch" && this._activePointerId !== e.pointerId) return true;
    // Reject touch when a pen/stylus has been seen (likely a pen tablet)
    if (e.pointerType === "touch" && this._hasPen) return true;
    return false;
  }

  _onDown(e) {
    e.preventDefault();
    if (this._isPalmRejected(e)) return;

    // Track whether this device has a pen (used to auto-enable palm rejection)
    if (e.pointerType === "pen") this._hasPen = true;
    // If already drawing with another pointer, ignore (first pointer wins)
    if (this.isDrawing) return;

    this.canvas.setPointerCapture(e.pointerId);
    this._activePointerId = e.pointerId;
    this.isDrawing = true;
    this._overlayFn = null; // clear overlay when user starts drawing
    this.canvas.classList.add("is-drawing");
    const pt = this._toCanvas(e);
    this.currentStroke = {
      points: [pt],
      isEraser: this.mode === "eraser",
      brushSize: this.getBrushSize(),
    };
    this._scheduleRedraw();
  }

  _onMove(e) {
    if (!this.isDrawing) return;
    if (e.pointerId !== this._activePointerId) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      this.currentStroke.points.push(this._toCanvas(ev));
    }
    this._scheduleRedraw();
  }

  _onUp(e) {
    if (!this.isDrawing) return;
    if (e.pointerId !== this._activePointerId) return;
    this.isDrawing = false;
    this._activePointerId = null;
    this.canvas.classList.remove("is-drawing");
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
    ctx.fillStyle = "#dde1ee";
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
    const { ctx } = this;
    const { points, isEraser, brushSize } = stroke;
    if (points.length === 0) return;

    const color = isEraser ? "white" : "#1a1a2e";
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;

    if (points.length === 1) {
      const r = brushSize * points[0].pressure;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
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
    ctx.fillStyle = "white";
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
    return !this.strokes.some((s) => !s.isEraser);
  }

  /**
   * Get the bounding box of visible ink on the canvas.
   * Reads actual pixel data so erased areas are correctly excluded.
   * Returns null if no dark pixels are found.
   * @returns {{ minX, maxX, minY, maxY, w, h, cx, cy } | null}
   */
  getBoundingBox() {
    // Flush any pending rAF so pixel data is current
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
      this._redraw();
    }

    const data = this.ctx.getImageData(0, 0, CANVAS_RES, CANVAS_RES).data;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let y = 0; y < CANVAS_RES; y++) {
      for (let x = 0; x < CANVAS_RES; x++) {
        // Ink is #1a1a2e (R=26); grid dots are #dde1ee (R=221); erased/bg is white (R=255)
        if (data[(y * CANVAS_RES + x) * 4] < 64) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (minX === Infinity) return null;
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
    return this.strokes.map((s) => ({
      points: s.points.slice(),
      isEraser: s.isEraser,
      brushSize: s.brushSize,
    }));
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
