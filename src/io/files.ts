export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export plátna selhal'))), type, quality);
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Otevře systémový dialog pro výběr souboru. Vrací null při zrušení. */
export async function pickFile(accept: string): Promise<File | null> {
  return (await pickFiles(accept, false))[0] ?? null;
}

/** Výběr jednoho nebo více souborů (prázdné pole = zrušeno). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'bez-nazvu';
}
