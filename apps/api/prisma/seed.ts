import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dev = await prisma.user.upsert({
    where: { email: 'dev@local.cloudblueprint.dev' },
    update: {},
    create: {
      email: 'dev@local.cloudblueprint.dev',
      name: 'Local Dev User',
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'local' },
    update: {},
    create: {
      slug: 'local',
      name: 'Local Org',
    },
  });

  await prisma.membership.upsert({
    where: { userId_orgId: { userId: dev.id, orgId: org.id } },
    update: {},
    create: { userId: dev.id, orgId: org.id, role: 'OWNER' },
  });

  console.info('Seeded:', { user: dev.email, org: org.slug });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
