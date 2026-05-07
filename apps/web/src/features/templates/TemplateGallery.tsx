import { allTemplates } from '@blueprint/templates';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@blueprint/ui';

/**
 * Modal in F5 that opens a card grid of templates. Selecting one shows a
 * Zod-driven param form, then `apply()`s the resulting IRPatch.
 */
export function TemplateGallery() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {allTemplates.map((t) => (
        <Card key={t.slug} className="cursor-pointer transition hover:border-primary">
          <CardHeader>
            <CardTitle>{t.name}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.provider}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
