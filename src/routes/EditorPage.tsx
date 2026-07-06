import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CanvasPane } from '@/features/editor/CanvasPane';
import { CodePane } from '@/features/editor/CodePane';
import { Inspector } from '@/features/editor/Inspector';
import { Palette } from '@/features/editor/Palette';
import { Topbar } from '@/features/editor/Topbar';
import { loadProjectIntoEditor, useEditor } from '@/features/editor/store';

const SPLIT_KEY = 'cb-split-pct';

function readSplit(): number {
  const v = Number(localStorage.getItem(SPLIT_KEY));
  return Number.isFinite(v) && v >= 20 && v <= 70 ? v : 40;
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [split, setSplit] = useState(readSplit);
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id || !loadProjectIntoEditor(id)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setReady(true);
  }, [id, navigate]);

  // global undo/redo (outside inputs & Monaco, which handle their own)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('input, textarea, select, [contenteditable], .monaco-editor') !== null
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const pct = 100 - ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(70, Math.max(20, pct));
      setSplit(clamped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSplit((v) => {
        localStorage.setItem(SPLIT_KEY, String(Math.round(v)));
        return v;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  if (!ready) return null;

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">Cloud Blueprint editor</h1>
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <div ref={splitRef} className="flex min-w-0 flex-1">
          <div className="min-w-0" style={{ width: `${100 - split}%` }}>
            <CanvasPane />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize code panel"
            className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 active:bg-primary"
            onPointerDown={startDrag}
          />
          <div className="min-w-[300px]" style={{ width: `${split}%` }}>
            <CodePane />
          </div>
        </div>
        <Inspector />
      </div>
    </div>
  );
}
