/**
 * Canvas actions that need the React Flow instance (viewport math, export),
 * exposed to UI outside the canvas tree — command palette, topbar, shortcuts.
 * The canvas registers itself on mount and clears on unmount.
 */
export interface CanvasApi {
  fitView(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** re-layout every resource (one undo step) */
  tidy(): Promise<void>;
  exportImage(format: 'png' | 'svg'): Promise<void>;
  /** add a catalog resource — at a screen point, or the viewport center */
  addResource(type: string, screen?: { x: number; y: number }): void;
  duplicate(nodeId: string): void;
  /** pan (without zooming) so a resource is on screen */
  focusNode(nodeId: string): void;
  toggleMinimap(): void;
}

let current: CanvasApi | null = null;

export function registerCanvasApi(api: CanvasApi | null) {
  current = api;
}

export function canvasApi(): CanvasApi | null {
  return current;
}
