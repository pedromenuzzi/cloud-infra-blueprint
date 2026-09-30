/**
 * Layout commands for the command palette (View group): the canvas toggle,
 * presets, reset, docking and moving panels to the other side. The palette
 * renders each with its own item component.
 */
import {
  ArrowLeftRight,
  Columns3,
  PanelRight,
  RotateCcw,
  SquareDashed,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMessages } from '@/i18n/messages';
import { layoutMessages } from './layout.messages';
import { PRESET_IDS } from './layoutPrefs';
import { useLayout } from './layoutStore';

export interface LayoutCommand {
  value: string;
  icon: LucideIcon;
  label: string;
  keywords: string[];
  run(): void;
}

export function LayoutCommands({ render }: { render(command: LayoutCommand): ReactNode }) {
  const m = useMessages(layoutMessages);
  const paletteSide = useLayout((s) => s.paletteSide);
  const codeSide = useLayout((s) => s.codeSide);
  const docked = useLayout((s) => s.inspectorMode === 'docked');
  const other = (side: 'left' | 'right') => (side === 'left' ? 'right' : 'left');
  const layout = () => useLayout.getState();
  const commands: LayoutCommand[] = [
    { value: 'toggle-canvas', icon: Workflow, label: m.toggleCanvas, keywords: ['hide', 'show', 'diagram'], run: () => layout().toggle('canvas') },
    ...PRESET_IDS.map((id) => ({
      value: `layout-${id}`,
      icon: id === 'default' ? Columns3 : SquareDashed,
      label: m.presetCommand(m.preset[id]),
      keywords: ['layout', 'preset', m.presetHint[id]],
      run: () => layout().applyPreset(id),
    })),
    {
      value: 'layout-move-palette',
      icon: ArrowLeftRight,
      label: m.moveCommand('palette', other(paletteSide)),
      keywords: ['layout', 'side', 'swap'],
      run: () => layout().setSide('palette', other(paletteSide)),
    },
    {
      value: 'layout-move-code',
      icon: ArrowLeftRight,
      label: m.moveCommand('code', other(codeSide)),
      keywords: ['layout', 'side', 'swap'],
      run: () => layout().setSide('code', other(codeSide)),
    },
    {
      value: 'layout-inspector-mode',
      icon: PanelRight,
      label: docked ? m.float : m.dock,
      keywords: ['layout', 'inspector', 'dock', 'float'],
      run: () => layout().setInspectorMode(docked ? 'floating' : 'docked'),
    },
    { value: 'layout-reset', icon: RotateCcw, label: m.reset, keywords: ['layout', 'default'], run: () => layout().reset() },
  ];
  return <>{commands.map(render)}</>;
}
