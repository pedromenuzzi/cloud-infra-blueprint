import { Link } from 'react-router-dom';
import { buttonClass, LogoMark } from '@/components/ui';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark size={44} />
      <h1 className="text-[26px] font-bold">Page not found</h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        This blueprint doesn't exist. Head back and keep designing.
      </p>
      {/* a link styled as a button — not a button inside a link */}
      <Link to="/dashboard" className={buttonClass()}>
        Back to projects
      </Link>
    </main>
  );
}
