import { Link } from 'react-router-dom';
import { Button, LogoMark } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <LogoMark size={44} />
      <h1 className="text-[26px] font-bold">Page not found</h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        This blueprint doesn't exist. Head back and keep designing.
      </p>
      <Link to="/dashboard">
        <Button>Back to projects</Button>
      </Link>
    </div>
  );
}
