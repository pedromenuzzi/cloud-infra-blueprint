/**
 * Editor layout texts: section toggles, collapsed strips, the Layout menu,
 * panel grips and drop zones, the inspector's minimize / dock / code reveal.
 */
import { defineMessages } from '@/i18n/messages';
import type { PresetId, SectionId, Side } from './layoutPrefs';

type Movable = 'palette' | 'code';

export const layoutMessages = defineMessages(
  {
    layout: 'Layout',
    layoutTitle: 'Layout — show, hide and arrange the panels',
    layoutMore: 'Layout…',
    presets: 'Presets',
    preset: {
      default: 'Default',
      'code-left': 'Code on the left',
      'canvas-focus': 'Canvas focus',
      'code-focus': 'Code focus',
    } satisfies Record<PresetId, string>,
    presetHint: {
      default: 'Resources, canvas and code',
      'code-left': 'Code left, resources right',
      'canvas-focus': 'Only the canvas',
      'code-focus': 'Only the code',
    } satisfies Record<PresetId, string>,
    sections: 'Sections',
    section: {
      palette: 'Resources',
      canvas: 'Canvas',
      code: 'Code',
      inspector: 'Inspector',
    } satisfies Record<SectionId, string>,
    arrangement: 'Arrangement',
    sideOf: { palette: 'Resources panel', code: 'Code editor' } satisfies Record<Movable, string>,
    side: { left: 'Left', right: 'Right' } satisfies Record<Side, string>,
    inspectorPlacement: 'Inspector',
    floating: 'Floating',
    docked: 'Docked',
    reset: 'Reset layout',
    dragTip: 'Tip: drag a panel by its grip to move it to the other side.',
    compactNote: 'On this screen size, resources and code open as drawers from their side; the inspector floats.',
    inspectorWithCanvas: 'Shown with the canvas',

    /* panel headers and strips */
    resourcesTitle: 'Resources',
    hide: {
      palette: 'Hide resource palette',
      canvas: 'Hide canvas',
      code: 'Hide code editor',
      inspector: 'Minimize inspector',
    } satisfies Record<SectionId, string>,
    /** the strips' names: each contains the strip's visible label */
    show: {
      palette: 'Show resources',
      canvas: 'Show canvas',
      code: 'Show code',
      inspector: 'Show inspector',
    } satisfies Record<SectionId, string>,
    moveTo: (panel: Movable, side: Side) =>
      `Move ${panel === 'palette' ? 'resource palette' : 'code editor'} to the ${side} — or drag it`,
    dropHere: (panel: Movable, side: Side) => `${panel === 'palette' ? 'Resources' : 'Code'} on the ${side}`,
    current: 'Current place',
    focusCanvas: 'Canvas focus — hide resources and code',
    exitFocus: 'Show resources and code again',
    expandCode: 'Expand the code — hide the canvas',
    showCanvasAgain: 'Show the canvas again',
    canvasControls: 'Canvas layout',

    /* inspector */
    codeButton: 'Code',
    codeButtonTitle: 'Show this block in the code editor',
    dockedEmpty: 'Select a resource on the canvas to see its settings here.',

    /* command palette */
    toggleCanvas: 'Toggle canvas',
    presetCommand: (name: string) => `Layout: ${name}`,
    dock: 'Dock the inspector beside the canvas',
    float: 'Float the inspector over the canvas',
    moveCommand: (panel: Movable, side: Side) =>
      `Move ${panel === 'palette' ? 'resource palette' : 'code editor'} to the ${side}`,
  },
  {
    layout: 'Layout',
    layoutTitle: 'Layout — mostrar, ocultar e organizar os painéis',
    layoutMore: 'Layout…',
    presets: 'Predefinições',
    preset: {
      default: 'Padrão',
      'code-left': 'Código à esquerda',
      'canvas-focus': 'Foco no canvas',
      'code-focus': 'Foco no código',
    },
    presetHint: {
      default: 'Recursos, canvas e código',
      'code-left': 'Código à esquerda, recursos à direita',
      'canvas-focus': 'Só o canvas',
      'code-focus': 'Só o código',
    },
    sections: 'Seções',
    section: {
      palette: 'Recursos',
      canvas: 'Canvas',
      code: 'Código',
      inspector: 'Inspetor',
    },
    arrangement: 'Disposição',
    sideOf: { palette: 'Painel de recursos', code: 'Editor de código' },
    side: { left: 'Esquerda', right: 'Direita' },
    inspectorPlacement: 'Inspetor',
    floating: 'Flutuante',
    docked: 'Fixo',
    reset: 'Restaurar layout',
    dragTip: 'Dica: arraste um painel pela alça para levá-lo ao outro lado.',
    compactNote: 'Nesta tela, recursos e código abrem como gavetas do lado escolhido; o inspetor flutua.',
    inspectorWithCanvas: 'Aparece junto com o canvas',

    resourcesTitle: 'Recursos',
    hide: {
      palette: 'Ocultar paleta de recursos',
      canvas: 'Ocultar canvas',
      code: 'Ocultar editor de código',
      inspector: 'Minimizar inspetor',
    },
    show: {
      palette: 'Mostrar recursos',
      canvas: 'Mostrar canvas',
      code: 'Mostrar código',
      inspector: 'Mostrar inspetor',
    },
    moveTo: (panel: Movable, side: Side) =>
      `Mover ${panel === 'palette' ? 'a paleta de recursos' : 'o editor de código'} para a ${side === 'left' ? 'esquerda' : 'direita'} — ou arraste`,
    dropHere: (panel: Movable, side: Side) =>
      `${panel === 'palette' ? 'Recursos' : 'Código'} à ${side === 'left' ? 'esquerda' : 'direita'}`,
    current: 'Lugar atual',
    focusCanvas: 'Foco no canvas — ocultar recursos e código',
    exitFocus: 'Mostrar recursos e código de novo',
    expandCode: 'Expandir o código — ocultar o canvas',
    showCanvasAgain: 'Mostrar o canvas de novo',
    canvasControls: 'Layout do canvas',

    codeButton: 'Código',
    codeButtonTitle: 'Mostrar este bloco no editor de código',
    dockedEmpty: 'Selecione um recurso no canvas para ver as configurações aqui.',

    toggleCanvas: 'Mostrar ou ocultar o canvas',
    presetCommand: (name: string) => `Layout: ${name}`,
    dock: 'Fixar o inspetor ao lado do canvas',
    float: 'Deixar o inspetor flutuando sobre o canvas',
    moveCommand: (panel: Movable, side: Side) =>
      `Mover ${panel === 'palette' ? 'a paleta de recursos' : 'o editor de código'} para a ${side === 'left' ? 'esquerda' : 'direita'}`,
  },
);
