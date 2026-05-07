import { useParams } from 'react-router-dom';

import { AppRail } from '@/components/AppRail';
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
 * The dark `AppRail` stays anchored on the very left across editor + dashboard.
 */
export function EditorRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = projectId ?? 'production-web';
  return (
    <div className="flex h-screen min-h-0 bg-background">
      <AppRail activeLabel="Projects" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar projectId={id} />
        <main className="flex min-h-0 flex-1" aria-label="Editor workspace">
          <h1 className="sr-only">{id} — visual editor</h1>
          <Palette />
          <section className="flex min-w-0 flex-1" aria-label="Canvas and code">
            <CanvasPane className="flex-1 border-r border-border/60" />
            <EditorPane className="flex-[1.1]" />
          </section>
          <Inspector />
        </main>
      </div>
    </div>
  );
}
