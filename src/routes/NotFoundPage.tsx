import { Link } from 'react-router-dom';
import { buttonClass, LogoMark } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark size={44} />
      <h1 className="text-[26px] font-bold">Page not found</h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        This blueprint doesn't exist. Head back and keep designing.
      </p>
      <Link to="/dashboard" className={buttonClass()}>
        Back to projects
      </Link>
    </main>
  );
}
