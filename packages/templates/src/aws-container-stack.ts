import { edge, newResource, ref } from '@blueprint/ir';
import { z } from 'zod';

import { defineTemplate } from './types.js';

export const containerStackAws = defineTemplate({
  slug: 'container-stack-aws',
  name: 'Container Stack on AWS',
  description: 'ECR + ECS Fargate + ALB + Target Group + VPC + IAM Task Role.',
  provider: 'aws',
  thumbnail: '/templates/container-stack-aws.png',
  params: z.object({
    appName: z.string().min(1).default('my-app'),
    region: z.string().default('us-east-1'),
  }),
  build({ appName }) {
    const vpc = newResource('aws_vpc', `${appName}-vpc`, {
      cidr_block: '10.0.0.0/16',
      tags: { Name: `${appName}-vpc` },
    });
    const subnet = newResource('aws_subnet', `${appName}-pub-a`, {
      vpc_id: ref({ type: 'aws_vpc', name: `${appName}-vpc` }),
      cidr_block: '10.0.1.0/24',
      map_public_ip_on_launch: true,
    });
    const taskRole = newResource('aws_iam_role', `${appName}-task-role`, {
      name: `${appName}-task-role`,
      assume_role_policy:
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}',
    });
    const sg = newResource('aws_security_group', `${appName}-alb-sg`, {
      name: `${appName}-alb-sg`,
      description: 'ALB security group',
      vpc_id: ref({ type: 'aws_vpc', name: `${appName}-vpc` }),
    });
    return {
      addResources: [vpc, subnet, taskRole, sg],
      addEdges: [edge(vpc, subnet, 'network'), edge(sg, taskRole, 'iam')],
      setProviders: { aws: { region: 'us-east-1' } },
    };
  },
});
