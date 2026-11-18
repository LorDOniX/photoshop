import { createElement, type IconNode } from 'lucide';

export type { IconNode };

export function icon(node: IconNode, size = 16, strokeWidth = 1.75): SVGElement {
  return createElement(node, { width: size, height: size, 'stroke-width': strokeWidth, class: 'icon' });
}
