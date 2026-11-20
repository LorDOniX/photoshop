import { createCanvas, get2d } from '../core/canvas';
import type { ImageDocument } from '../core/ImageDocument';
import { flattenDocument } from '../render/composite';
import { canvasToBlob } from './files';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export async function exportImage(doc: ImageDocument, format: ExportFormat, quality = 0.92): Promise<Blob> {
  const flat = flattenDocument(doc);
  if (format === 'png') return canvasToBlob(flat, 'image/png');
  // WEBP umí průhlednost; prohlížeč bez kodéru WEBP (starší Safari) vrátí PNG – volající to pozná podle typu.
  if (format === 'webp') return canvasToBlob(flat, 'image/webp', quality);
  // JPEG nemá průhlednost – podložíme bílou.
  const out = createCanvas(doc.width, doc.height);
  const ctx = get2d(out);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(flat, 0, 0);
  return canvasToBlob(out, 'image/jpeg', quality);
}
