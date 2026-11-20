import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createCanvas, get2d } from '../core/canvas';
import { ImageDocument } from '../core/ImageDocument';
import { Layer, type LayerProps } from '../core/Layer';
import { setTextData, type TextData } from '../core/text';
import { canvasToBlob } from './files';

export const PROJECT_EXTENSION = '.ptsp';
const FORMAT = 'photoshop-ts-project';
/** 1 = vrstvy, 2 = + masky vrstev, 3 = + textové vrstvy a skupiny. */
const VERSION = 3;

interface LayerManifest extends Omit<LayerProps, 'maskEnabled'> {
  id: string;
  width: number;
  height: number;
  file: string;
  /** Od verze 2. Hodnota masky je v alfa kanálu PNG. */
  mask?: { file: string; enabled: boolean };
  /** Od verze 3: textová vrstva (PNG obsahuje vykreslený text, takže ji otevře i starší verze jako rastr). */
  text?: TextData;
  /** Od verze 3: skupina (bez PNG, `file` je prázdný) a zařazení vrstvy do skupiny. */
  group?: { collapsed: boolean };
  parentId?: string | null;
}

interface ProjectManifest {
  format: typeof FORMAT;
  version: number;
  width: number;
  height: number;
  activeLayerId: string | null;
  /** Odspodu nahoru. */
  layers: LayerManifest[];
}

/** Zámky vrstvy (starší projekty je nemají). */
function locksOf(lm: Partial<LayerManifest>): Pick<LayerProps, 'lockTransparency' | 'lockPixels' | 'lockPosition' | 'clipped'> {
  return { lockTransparency: !!lm.lockTransparency, lockPixels: !!lm.lockPixels, lockPosition: !!lm.lockPosition, clipped: !!lm.clipped };
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
}

async function fromPng(bytes: Uint8Array, target: HTMLCanvasElement): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  get2d(target).drawImage(bitmap, 0, 0);
  bitmap.close();
}

/**
 * Projekt = ZIP s `project.json` (struktura, vlastnosti vrstev) a bezeztrátovými PNG vrstvami a maskami.
 * Formát je verzovaný; starší verze se dají dál otevírat.
 */
export async function saveProject(doc: ImageDocument): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const layers: LayerManifest[] = [];
  for (const layer of doc.layers) {
    const { maskEnabled, ...props } = layer.getProps();
    if (layer.isGroup) {
      layers.push({ id: layer.id, width: 1, height: 1, file: '', ...props, group: { collapsed: layer.collapsed }, parentId: layer.parentId });
      continue;
    }
    const file = `layers/${layer.id}.png`;
    files[file] = await toPng(layer.canvas);
    const entry: LayerManifest = { id: layer.id, width: layer.width, height: layer.height, file, ...props, parentId: layer.parentId };
    if (layer.mask) {
      const maskFile = `layers/${layer.id}.mask.png`;
      files[maskFile] = await toPng(layer.mask);
      entry.mask = { file: maskFile, enabled: maskEnabled };
    }
    const text = layer.text;
    if (text) entry.text = text;
    layers.push(entry);
  }
  const manifest: ProjectManifest = {
    format: FORMAT,
    version: VERSION,
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    layers,
  };
  files['project.json'] = strToU8(JSON.stringify(manifest, null, 2));
  // PNG jsou už komprimované – ukládáme bez další komprese (rychlejší).
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export async function loadProject(data: ArrayBuffer): Promise<ImageDocument> {
  const files = unzipSync(new Uint8Array(data));
  const json = files['project.json'];
  if (!json) throw new Error('Soubor neobsahuje project.json – nejde o projekt PhotoshopTS.');
  const manifest = JSON.parse(strFromU8(json)) as ProjectManifest;
  if (manifest.format !== FORMAT) throw new Error('Neznámý formát projektu.');
  if (manifest.version > VERSION) throw new Error(`Projekt je z novější verze (${manifest.version}).`);

  const doc = new ImageDocument(manifest.width, manifest.height);
  for (const lm of manifest.layers) {
    if (lm.group) {
      const { id, name, visible, opacity, blendMode, x, y } = lm;
      const group = new Layer(1, 1, { id, name, visible, opacity, blendMode, x, y, group: true, parentId: lm.parentId ?? null, ...locksOf(lm) });
      group.collapsed = lm.group.collapsed;
      doc.insertLayer(group);
      continue;
    }
    const bytes = files[lm.file];
    if (!bytes) throw new Error(`Chybí data vrstvy ${lm.name}.`);
    const { id, name, visible, opacity, blendMode, x, y } = lm;
    const layer = new Layer(lm.width, lm.height, { id, name, visible, opacity, blendMode, x, y, maskEnabled: lm.mask?.enabled ?? true, parentId: lm.parentId ?? null, ...locksOf(lm) });
    await fromPng(bytes, layer.canvas);
    if (lm.text) setTextData(layer.canvas, lm.text);
    if (lm.mask) {
      const maskBytes = files[lm.mask.file];
      if (!maskBytes) throw new Error(`Chybí maska vrstvy ${lm.name}.`);
      layer.mask = createCanvas(lm.width, lm.height);
      await fromPng(maskBytes, layer.mask);
    }
    doc.insertLayer(layer);
  }
  doc.setActive(manifest.activeLayerId);
  return doc;
}