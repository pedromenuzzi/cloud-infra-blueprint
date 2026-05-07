import { useCallback, useEffect, useState } from 'react';

import { api, type ApiError } from './api';

export type ProjectProvider = 'aws' | 'azure' | 'gcp' | 'multi';

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  provider: ProjectProvider;
  updatedAgo: string;
  collaborators: string[];
}

/** Demo projects used when the API is unreachable or empty (first-run UX). */
const DEMO_PROJECTS: ProjectMeta[] = [
  {
    id: 'production-web-aws',
    name: 'production-web-aws',
    description: 'Production VPC with EC2, RDS, S3 and ALB.',
    provider: 'aws',
    updatedAgo: '2h ago',
    collaborators: ['Pedro Silva', 'Maria Souza', 'Bob Lin'],
  },
  {
    id: 'data-pipeline',
    name: 'data-pipeline',
    description: 'Event Hubs + Stream Analytics + Synapse pipeline.',
    provider: 'azure',
    updatedAgo: '2h ago',
    collaborators: ['Anna Voss', 'Tomás Reis'],
  },
  {
    id: 'static-site-cdn',
    name: 'static-site-cdn',
    description: 'S3 + CloudFront static site with Route53.',
    provider: 'aws',
    updatedAgo: '3h ago',
    collaborators: ['Pedro Silva'],
  },
  {
    id: 'k8s-cluster-multi',
    name: 'k8s-cluster-multi',
    description: 'GKE + EKS multi-region with shared registry.',
    provider: 'multi',
    updatedAgo: '4h ago',
    collaborators: ['Maria Souza', 'Anna Voss', 'Bob Lin', 'Henry Park'],
  },
  {
    id: 'monitoring-stack',
    name: 'monitoring-stack',
    description: 'Cloud Logging + BigQuery sinks + Grafana.',
    provider: 'gcp',
    updatedAgo: '5h ago',
    collaborators: ['Henry Park', 'Tomás Reis'],
  },
  {
    id: 'azure-corp-vnet',
    name: 'azure-corp-vnet',
    description: 'Hub-and-spoke VNet with peering and Bastion.',
    provider: 'azure',
    updatedAgo: '6h ago',
    collaborators: ['Anna Voss'],
  },
  {
    id: 'gcp-bigquery-warehouse',
    name: 'gcp-bigquery-warehouse',
    description: 'BigQuery + Pub/Sub + Dataflow ETL.',
    provider: 'gcp',
    updatedAgo: '8h ago',
    collaborators: ['Tomás Reis', 'Henry Park'],
  },
  {
    id: 'lambda-api-edge',
    name: 'lambda-api-edge',
    description: 'API Gateway + Lambda + DynamoDB at the edge.',
    provider: 'aws',
    updatedAgo: '10h ago',
    collaborators: ['Pedro Silva', 'Bob Lin'],
  },
  {
    id: 'ecs-fargate-app',
    name: 'ecs-fargate-app',
    description: 'ECS Fargate cluster with ALB + ECR + Secrets.',
    provider: 'multi',
    updatedAgo: '1d ago',
    collaborators: ['Maria Souza', 'Anna Voss', 'Henry Park'],
  },
];

interface ApiProject {
  id: string;
  name: string;
  description: string | null;
  defaultProvider: string;
  updatedAt: string;
}

interface UseProjectsResult {
  projects: ProjectMeta[];
  loading: boolean;
  offline: boolean;
  error?: ApiError;
  refresh: () => void;
  /**
   * Optimistically prepends a project to the local list. Used by the dashboard
   * after creating a project so the new card appears instantly without a full
   * refetch round-trip.
   */
  addLocal: (project: ProjectMeta) => void;
}

const ORG_ID_PARAM = (import.meta.env.VITE_ORG_ID as string | undefined) ?? 'local';

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectMeta[]>(DEMO_PROJECTS);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<ApiProject[]>(
        `/projects?orgId=${encodeURIComponent(ORG_ID_PARAM)}`,
        {
          timeoutMs: 4000,
        },
      );
      setProjects(list.length === 0 ? DEMO_PROJECTS : list.map(adaptApiProject));
      setOffline(false);
      setError(undefined);
    } catch (err) {
      setOffline(true);
      setError(err as ApiError);
      // Fall back to demos.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const addLocal = useCallback((project: ProjectMeta) => {
    setProjects((prev) => [project, ...prev]);
  }, []);

  return { projects, loading, offline, error, refresh: fetchProjects, addLocal };
}

function adaptApiProject(p: ApiProject): ProjectMeta {
  const provider = (
    ['aws', 'azure', 'gcp', 'multi'].includes(p.defaultProvider)
      ? (p.defaultProvider as ProjectProvider)
      : 'multi'
  ) as ProjectProvider;
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    provider,
    updatedAgo: relativeTime(p.updatedAt),
    collaborators: [],
  };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export { DEMO_PROJECTS };
