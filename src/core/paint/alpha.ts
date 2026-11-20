/**
 * Zámek průhlednosti: po úpravě se vrátí původní alfa pixelů – mění se jen barva tam,
 * kde už něco bylo; průhledné pixely zůstanou průhledné.
 */
export function restoreAlphaData(after: Uint8ClampedArray, before: Uint8ClampedArray): void {
  for (let i = 3; i < after.length; i += 4) {
    const a = before[i];
    after[i] = a;
    if (a === 0) after[i - 3] = after[i - 2] = after[i - 1] = 0;
  }
}

/** Totéž nad oblastí kontextu; `before` = pixely oblasti před úpravou. */
export function restoreAlpha(ctx: CanvasRenderingContext2D, x: number, y: number, before: ImageData): void {
  const img = ctx.getImageData(x, y, before.width, before.height);
  restoreAlphaData(img.data, before.data);
  ctx.putImageData(img, x, y);
}
