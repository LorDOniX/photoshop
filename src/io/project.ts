import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ImageDocument } from '../core/ImageDocument';
import { Layer, type LayerProps } from '../core/Layer';
import { canvasToBlob } from './files';

export const PROJECT_EXTENSION = '.ptsp';
const FORMAT = 'photoshop-ts-project';
const VERSION = 1;

interface LayerManifest extends LayerProps {
  id: string;
  width: number;
  height: number;
  file: string;
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

/**
 * Projekt = ZIP s `project.json` (struktura, vlastnosti vrstev) a bezeztrátovými PNG vrstvami.
 * Formát je verzovaný, aby šlo později přidat masky, výběry atd.
 */
export async function saveProject(doc: ImageDocument): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const layers: LayerManifest[] = [];
  for (const layer of doc.layers) {
    const file = `layers/${layer.id}.png`;
    const png = await canvasToBlob(layer.canvas, 'image/png');
    files[file] = new Uint8Array(await png.arrayBuffer());
    layers.push({ id: layer.id, width: layer.width, height: layer.height, file, ...layer.getProps() });
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
    const bytes = files[lm.file];
    if (!bytes) throw new Error(`Chybí data vrstvy ${lm.name}.`);
    const { id, name, visible, opacity, blendMode, x, y } = lm;
    const layer = new Layer(lm.width, lm.height, { id, name, visible, opacity, blendMode, x, y });
    const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    layer.ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    doc.insertLayer(layer);
  }
  doc.setActive(manifest.activeLayerId);
  return doc;
}
