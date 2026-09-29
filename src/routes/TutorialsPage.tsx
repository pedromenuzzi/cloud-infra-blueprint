import { ArrowRight, Clock, ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppRail } from '@/components/AppRail';
import { ProjectThumbnail } from '@/components/ProjectThumbnail';
import { Badge } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { PROVIDER_LABELS } from '@/resources/icons';
import { TUTORIALS } from '@/tutorials';
import { tutorialText } from '@/tutorials/i18n';
import { routeMessages } from './messages';

export default function TutorialsPage() {
  const navigate = useNavigate();
  const m = useMessages(routeMessages);
  useDocumentTitle(m.tutorials);

  return (
    <div className="flex h-full">
      <AppRail active="tutorials" />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <h1 className="text-[26px] font-bold tracking-[-0.01em]">{m.tutorials}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{m.tutorialsIntro}</p>

          <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {TUTORIALS.map((t) => {
              const finalFiles = t.steps[t.steps.length - 1].files;
              const text = tutorialText(t);
              return (
                <div
                  key={t.slug}
                  role="button"
                  tabIndex={0}
                  aria-label={m.startTutorial(text.title)}
                  onClick={() => navigate(`/tutorials/${t.slug}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/tutorials/${t.slug}`);
                  }}
                  className="group cursor-pointer overflow-hidden rounded-md border bg-surface-1 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative border-b bg-canvas p-3">
                    <ProjectThumbnail files={finalFiles} className="h-36 w-full text-foreground" />
                    <Badge
                      variant={t.level === 'Beginner' ? 'success' : 'default'}
                      className="absolute left-2.5 top-2.5"
                    >
                      {t.level === 'Beginner' ? m.beginner : m.intermediate}
                    </Badge>
                    {t.providers[0] && t.providers[0] !== 'other' ? (
                      <Badge variant={t.providers[0]} className="absolute right-2.5 top-2.5">
                        {PROVIDER_LABELS[t.providers[0]]}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h2 className="text-[15px] font-semibold">{text.title}</h2>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{text.description}</p>
                    <div className="mt-3 flex items-center justify-between text-[11.5px] text-faint">
                      <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <ListChecks className="h-3.5 w-3.5" /> {m.steps(t.steps.length)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" /> ~{t.minutes} min
                        </span>
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-primary">
                        {m.start} <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-[11.5px] text-faint">{m.tutorialsFooter}</p>
        </div>
      </main>
    </div>
  );
}
