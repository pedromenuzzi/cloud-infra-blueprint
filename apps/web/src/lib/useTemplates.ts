import { useEffect, useState } from 'react';

import { api, type ApiError } from './api';

export interface TemplateMeta {
  slug: string;
  name: string;
  description: string;
  provider: 'aws' | 'azure' | 'gcp' | 'kubernetes' | 'random' | 'tls';
  thumbnail: string;
}

/**
 * Bundled-in fallback list. When the API is offline (CI demo, GitHub Pages,
 * pure-frontend mode), `useTemplates` returns these so the UI keeps working.
 *
 * Stays in sync with `packages/templates/src/index.ts` — the only addition
 * here is `thumbnail` which the API also exposes.
 */
const BUNDLED_TEMPLATES: TemplateMeta[] = [
  {
    slug: 'web-app-aws',
    name: 'Web App on AWS',
    description: 'EC2 + RDS PostgreSQL behind a VPC with public subnets and security groups.',
    provider: 'aws',
    thumbnail: '/templates/web-app-aws.png',
  },
  {
    slug: 'static-site-aws',
    name: 'Static Site on AWS',
    description: 'S3 (website) + CloudFront. Add ACM + Route53 manually after applying.',
    provider: 'aws',
    thumbnail: '/templates/static-site-aws.png',
  },
  {
    slug: 'container-stack-aws',
    name: 'Container Stack on AWS',
    description: 'ECR + ECS Fargate + ALB + Target Group + VPC + IAM Task Role.',
    provider: 'aws',
    thumbnail: '/templates/container-stack-aws.png',
  },
  {
    slug: 'web-app-azure',
    name: 'Web App on Azure',
    description: 'Resource Group + VNet + Subnet + Linux VM + SQL Database.',
    provider: 'azure',
    thumbnail: '/templates/web-app-azure.png',
  },
  {
    slug: 'static-site-gcp',
    name: 'Static Site on GCP',
    description: 'Cloud Storage bucket configured for website hosting (add LB + DNS later).',
    provider: 'gcp',
    thumbnail: '/templates/static-site-gcp.png',
  },
];

interface UseTemplatesResult {
  templates: TemplateMeta[];
  /** `true` until the first response (or fallback) is ready. */
  loading: boolean;
  /** `true` if we're showing the bundled fallback because the API is unreachable. */
  offline: boolean;
  /** Network/HTTP error, exposed for advanced callers; UI usually ignores this. */
  error?: ApiError;
}

/**
 * Loads the template catalog. Tries the backend first, falls back to bundled
 * data when offline. Returns immediately with the fallback so the UI never
 * blanks out.
 */
export function useTemplates(): UseTemplatesResult {
  const [templates, setTemplates] = useState<TemplateMeta[]>(BUNDLED_TEMPLATES);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  useEffect(() => {
    let cancelled = false;
    api
      .get<TemplateMeta[]>('/templates', { timeoutMs: 4000 })
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        setOffline(false);
        setError(undefined);
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setOffline(true);
        setError(err);
        // Keep the bundled fallback already in state.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loading, offline, error };
}

export { BUNDLED_TEMPLATES };
