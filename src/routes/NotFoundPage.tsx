import { Link } from 'react-router-dom';
import { LogoMark } from '@/components/ui';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark size={44} />
      <h1 className="text-[26px] font-bold">Page not found</h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        This blueprint doesn't exist. Head back and keep designing.
      </p>
      {/* a link styled as a button — not a button inside a link */}
      <Link
        to="/dashboard"
        className="inline-flex h-8.5 select-none items-center justify-center gap-2 rounded-sm border border-transparent bg-primary px-3.5 text-[13px] font-medium text-primary-fg shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Back to projects
      </Link>
    </div>
  );
}
