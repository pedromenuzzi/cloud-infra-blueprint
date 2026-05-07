import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsDbInstance = defineResource({
  provider: 'aws',
  type: 'aws_db_instance',
  category: 'Database',
  displayName: 'RDS Database',
  description: 'Managed relational database (RDS).',
  icon: '/icons/aws/rds.svg',
  tags: ['database', 'rds', 'sql'],
  schema: z.object({
    identifier: z.string().optional(),
    engine: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver-ex']),
    engine_version: z.string().optional(),
    instance_class: z.enum(['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.m5.large']),
    allocated_storage: z.number().int().min(20).max(65536).optional(),
    db_name: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    skip_final_snapshot: z.boolean().optional(),
    vpc_security_group_ids: z.array(z.string()).optional(),
    db_subnet_group_name: z.string().optional(),
    publicly_accessible: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: {
    engine: 'postgres',
    instance_class: 'db.t3.micro',
    allocated_storage: 20,
    skip_final_snapshot: true,
  },
  ports: {
    in: [{ kind: 'network', label: 'connections from' }],
    out: [],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_db_instance', res.name], res.args);
  },
});
