import type { CaptureOptions } from '@/features/export/captureDiagram';
import type { DiagramVector } from '@/features/export/diagramVector';

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
  /** re-layout one container's contents (one undo step) */
  arrangeInside(containerId: string): void;
  exportImage(format: 'png' | 'svg'): Promise<void>;
  /** the whole diagram as vector geometry for the PDF document; null when the canvas is empty */
  captureDiagram(options?: CaptureOptions): Promise<DiagramVector | null>;
  /** add a catalog resource — at a screen point, or the viewport center */
  addResource(type: string, screen?: { x: number; y: number }): void;
  /**
   * With a container selected: add a catalog resource as if dropped on it
   * (into its next free cell, into the ancestor that takes it, or beside it
   * with the reason) — one undo step. The new id; null without a container.
   */
  addToSelection(type: string): string | null;
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
