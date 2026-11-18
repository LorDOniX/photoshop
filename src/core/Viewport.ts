const ZOOM_STEPS = [
  0.02, 0.03, 0.05, 0.0667, 0.1, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 64,
];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Převod mezi souřadnicemi obrazovky (CSS px v plátně) a dokumentu. */
export class Viewport {
  zoom = 1;
  /** Pozice počátku dokumentu na obrazovce. */
  panX = 0;
  panY = 0;
  /** Velikost viditelné oblasti (CSS px). */
  width = 0;
  height = 0;

  toDoc(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  toScreen(dx: number, dy: number): { x: number; y: number } {
    return { x: dx * this.zoom + this.panX, y: dy * this.zoom + this.panY };
  }

  zoomAt(zoom: number, sx = this.width / 2, sy = this.height / 2): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const k = next / this.zoom;
    this.panX = sx - (sx - this.panX) * k;
    this.panY = sy - (sy - this.panY) * k;
    this.zoom = next;
  }

  /** Další/předchozí „hezký“ stupeň zvětšení. */
  stepZoom(direction: 1 | -1, sx?: number, sy?: number): void {
    const z = this.zoom;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM)
        : ([...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? MIN_ZOOM);
    this.zoomAt(next, sx, sy);
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  center(docWidth: number, docHeight: number): void {
    this.panX = Math.round((this.width - docWidth * this.zoom) / 2);
    this.panY = Math.round((this.height - docHeight * this.zoom) / 2);
  }

  fit(docWidth: number, docHeight: number, allowUpscale = true, margin = 32): void {
    const zx = (this.width - margin * 2) / docWidth;
    const zy = (this.height - margin * 2) / docHeight;
    let zoom = Math.max(MIN_ZOOM, Math.min(zx, zy));
    if (!allowUpscale) zoom = Math.min(zoom, 1);
    this.zoom = Math.min(zoom, MAX_ZOOM);
    this.center(docWidth, docHeight);
  }
}
