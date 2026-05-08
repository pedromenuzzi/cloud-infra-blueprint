import { useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useParams } from 'react-router-dom';

import { AppRail } from '@/components/AppRail';
import { OnboardingTour } from '@/components/OnboardingTour';
import { CanvasPane } from '@/features/canvas/CanvasPane';
import { EditorPane } from '@/features/editor/EditorPane';
import { Inspector } from '@/features/inspector/Inspector';
import { Palette } from '@/features/palette/Palette';
import { Topbar } from '@/features/topbar/Topbar';

/**
 * Main split-pane editor (image 01/02 reference):
 *
 *   +-----+---------------------------------------------------------+
 *   | R   | Topbar  (breadcrumb · collaborators · Saved · Share · Export) |
 *   | a   +-----------+----------------+----------------+-----------+
 *   | i   |  Palette  | Canvas         | Code (Monaco)  | Inspector |
 *   | l   |           |                |                |           |
 *   +-----+-----------+----------------+----------------+-----------+
 *
 * The four center panels are independently resizable via drag handles powered
 * by `react-resizable-panels`. Each panel has a sensible default size and a
 * minimum so layout stays usable on smaller screens. Sizes are persisted per
 * group via `autoSaveId`.
 *
 * The dark `AppRail` stays anchored on the very left across editor + dashboard.
 */
export function EditorRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = projectId ?? 'production-web';
  const [tourOpen, setTourOpen] = useState<boolean | undefined>(undefined);
  return (
    <div className="flex h-screen min-h-0 bg-background">
      <AppRail activeLabel="Projects" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar projectId={id} onOpenHelp={() => setTourOpen(true)} />
        <main className="flex min-h-0 flex-1" aria-label="Editor workspace">
          <h1 className="sr-only">{id} — visual editor</h1>
          <PanelGroup
            direction="horizontal"
            autoSaveId="blueprint-editor-layout-v1"
            className="flex min-h-0 flex-1"
          >
            <Panel defaultSize={18} minSize={12} maxSize={32} order={1} id="palette">
              <Palette />
            </Panel>
            <PanelHandle />
            <Panel defaultSize={36} minSize={20} order={2} id="canvas">
              <CanvasPane className="h-full w-full" />
            </Panel>
            <PanelHandle />
            <Panel defaultSize={30} minSize={20} order={3} id="code">
              <EditorPane className="h-full w-full" />
            </Panel>
            <PanelHandle />
            <Panel defaultSize={16} minSize={12} maxSize={32} order={4} id="inspector">
              <Inspector />
            </Panel>
          </PanelGroup>
        </main>
      </div>

      <OnboardingTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}

/**
 * 6px-wide draggable separator between editor panels. Becomes brighter on
 * hover and uses a col-resize cursor; keyboard users can focus and use
 * arrow keys (handled by react-resizable-panels) to nudge sizes.
 */
function PanelHandle() {
  return (
    <PanelResizeHandle className="group relative w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40 data-[resize-handle-active]:bg-primary">
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/0 group-hover:bg-primary/40"
      />
    </PanelResizeHandle>
  );
}
