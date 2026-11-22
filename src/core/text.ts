import { createCanvas, get2d, type Rect } from './canvas';

/*
 * Textové vrstvy. Text se vykresluje do běžného plátna vrstvy; textová data jsou svázaná
 * s KONKRÉTNÍM plátnem (WeakMap). Každá operace, která plátno nahradí (transformace, oříznutí,
 * sloučení…), tak vrstvu automaticky „zrastruje“ a undo vrátí původní plátno i s textem.
 * Úpravy pixelů na místě (štětec, výplň) musí vrstvu nejdřív zrastrovat – viz Editor.rasterizeLayer.
 */

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bold italic';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextData {
  content: string;
  family: string;
  style: FontStyle;
  /** Velikost písma v px dokumentu. */
  size: number;
  color: string;
  align: TextAlign;
  /** Řádkování jako násobek velikosti písma. */
  lineHeight: number;
  /**
   * Text převzatý z PSD: pixely vykreslil Photoshop, `origin` je začátek účaří prvního řádku v dokumentu.
   * Při první úpravě se text vykreslí editorem a umístí podle tohoto bodu (pak se `origin` zahodí).
   */
  origin?: { x: number; y: number };
}

export const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  'system-ui',
];

export const FONT_STYLES: ReadonlyArray<{ value: FontStyle; label: string }> = [
  { value: 'normal', label: 'Normální' },
  { value: 'bold', label: 'Tučné' },
  { value: 'italic', label: 'Kurzíva' },
  { value: 'bold italic', label: 'Tučná kurzíva' },
];

export const DEFAULT_TEXT: TextData = {
  content: '',
  family: 'Arial',
  style: 'normal',
  size: 48,
  color: '#000000',
  align: 'left',
  lineHeight: 1.2,
};

const textOfCanvas = new WeakMap<HTMLCanvasElement, TextData>();

/** Textová data plátna (null = rastrová vrstva). */
export function getTextData(canvas: HTMLCanvasElement): TextData | null {
  return textOfCanvas.get(canvas) ?? null;
}

export function setTextData(canvas: HTMLCanvasElement, data: TextData): void {
  textOfCanvas.set(canvas, { ...data });
}

/** CSS zápis písma (stejný pro canvas i textové pole editoru). */
export function cssFont(d: TextData, size = d.size): string {
  const family = d.family === 'system-ui' ? 'system-ui' : `"${d.family}"`;
  return `${d.style === 'normal' ? '' : `${d.style} `}${size}px ${family}, sans-serif`;
}

/** Svislý okraj kolem textu (diakritika, dotažnice). */
export function padY(d: TextData): number {
  return Math.ceil(d.size * 0.3);
}

/** Vodorovný okraj – kurzíva přesahuje šířku znaků. */
export function padX(d: TextData): number {
  return Math.ceil(d.size * (d.style.includes('italic') ? 0.35 : 0.15));
}

export interface TextLayout {
  lines: string[];
  widths: number[];
  /** Šířka nejdelšího řádku. */
  contentWidth: number;
  width: number;
  height: number;
  padX: number;
  padY: number;
  /** Výška řádku v px. */
  lineHeight: number;
}

/** Rozložení textu (čistá funkce – měření šířky řádku dodá volající). */
export function layoutText(d: TextData, measure: (line: string) => number): TextLayout {
  const lines = d.content.split('\n');
  const widths = lines.map((l) => (l ? measure(l) : 0));
  const contentWidth = Math.max(d.size * 0.5, ...widths);
  const px = padX(d);
  const py = padY(d);
  const lineHeight = d.size * d.lineHeight;
  return {
    lines,
    widths,
    contentWidth,
    width: Math.ceil(contentWidth + px * 2),
    height: Math.ceil(lines.length * lineHeight + py * 2),
    padX: px,
    padY: py,
    lineHeight,
  };
}

/** Začátek řádku `i` v plátně podle zarovnání. */
export function lineStart(layout: TextLayout, i: number, align: TextAlign): number {
  const free = layout.contentWidth - layout.widths[i];
  return layout.padX + (align === 'left' ? 0 : align === 'center' ? free / 2 : free);
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function measureLayout(d: TextData): TextLayout {
  measureCtx ??= get2d(createCanvas(1, 1));
  measureCtx.font = cssFont(d);
  const ctx = measureCtx;
  return layoutText(d, (line) => ctx.measureText(line).width);
}

/** Vykreslí text do nového plátna a sváže s ním textová data. */
export function renderText(d: TextData): HTMLCanvasElement {
  const layout = measureLayout(d);
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = get2d(canvas);
  ctx.font = cssFont(d);
  ctx.fillStyle = d.color;
  ctx.textBaseline = 'middle';
  layout.lines.forEach((line, i) => {
    if (line) ctx.fillText(line, lineStart(layout, i, d.align), layout.padY + (i + 0.5) * layout.lineHeight);
  });
  setTextData(canvas, d);
  return canvas;
}

/**
 * Nová poloha levého horního rohu po změně textu tak, aby zůstal na místě zarovnaný okraj
 * (vlevo / střed / vpravo) a střed prvního řádku.
 */
export function anchoredPosition(
  old: { x: number; y: number; width: number; data: TextData },
  next: { width: number; data: TextData },
): { x: number; y: number } {
  const op = padX(old.data);
  const np = padX(next.data);
  let x: number;
  if (next.data.align === 'left') x = old.x + op - np;
  else if (next.data.align === 'right') x = old.x + old.width - op - (next.width - np);
  else x = old.x + old.width / 2 - next.width / 2;
  const firstLine = (d: TextData) => padY(d) + (d.size * d.lineHeight) / 2;
  return { x: Math.round(x), y: Math.round(old.y + firstLine(old.data) - firstLine(next.data)) };
}

/** Poloha nové textové vrstvy, aby kliknutí leželo na účaří prvního řádku na začátku textu. */
export function positionForClick(px: number, py: number, d: TextData, width: number): { x: number; y: number } {
  const p = padX(d);
  const x = d.align === 'left' ? px - p : d.align === 'right' ? px - width + p : px - width / 2;
  // Účaří leží zhruba 0,3 velikosti písma pod středem řádku.
  const y = py - padY(d) - (d.size * d.lineHeight) / 2 - d.size * 0.3;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Začátek účaří prvního řádku textové vrstvy v dokumentu (opak `positionForClick`; u zarovnání na střed / vpravo jeho střed / konec). */
export function textOrigin(l: { x: number; y: number; width: number }, d: TextData): { x: number; y: number } {
  const p = padX(d);
  const x = d.align === 'left' ? l.x + p : d.align === 'right' ? l.x + l.width - p : l.x + l.width / 2;
  return { x, y: l.y + padY(d) + (d.size * d.lineHeight) / 2 + d.size * 0.3 };
}

/** Výchozí název textové vrstvy = začátek prvního řádku. */
export function autoLayerName(content: string): string {
  const first = content.split('\n').find((l) => l.trim())?.trim() ?? '';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first || 'Text';
}

/**
 * Přizpůsobí masku novému obdélníku vrstvy: nová plocha je odkrytá, stará maska zůstane
 * na stejném místě v dokumentu (volitelně zvětšená na `oldRect.width/height`).
 */
export function refitMask(mask: HTMLCanvasElement, oldRect: Rect, newRect: Rect): HTMLCanvasElement {
  const out = createCanvas(newRect.width, newRect.height);
  const ctx = get2d(out);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  const dx = oldRect.x - newRect.x;
  const dy = oldRect.y - newRect.y;
  ctx.clearRect(dx, dy, oldRect.width, oldRect.height);
  ctx.drawImage(mask, dx, dy, oldRect.width, oldRect.height);
  return out;
}
