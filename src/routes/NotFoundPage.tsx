import { Link } from 'react-router-dom';
import { buttonClass, LogoMark } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { routeMessages } from './messages';

export default function NotFoundPage() {
  const m = useMessages(routeMessages);
  useDocumentTitle(m.notFound);
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark size={44} />
      <h1 className="text-[26px] font-bold">{m.notFound}</h1>
      <p className="max-w-sm text-[13.5px] text-muted">{m.notFoundBody}</p>
      {/* a link styled as a button — not a button inside a link */}
      <Link to="/dashboard" className={buttonClass()}>
        {m.backToProjects}
      </Link>
    </main>
  );
}
