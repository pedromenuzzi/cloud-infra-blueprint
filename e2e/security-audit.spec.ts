/**
 * The security feature in one sitting: a project with a risky rule opens
 * with a poor grade and the finding that explains it; its fix lands in the
 * Terraform and the grade improves; the security lens draws the internet
 * and what it reaches on the canvas; the rules editor edits a rule into
 * the code, the lens follows, and undo brings both back. No sleeps: every
 * step waits on what the screen or the stored project shows.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, storedProject } from './helpers';

const RISKY = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami                    = "ami-0c55b159cbfafe1f0"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]

  metadata_options {
    http_tokens = "required"
  }
}
`;

const NAME = 'risky-web';
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, NAME))?.files['main.tf'] ?? '';
const gradeButton = (page: Page) => page.getByRole('button', { name: /^Security grade [A-F]/ }).first();
const GRADES = 'ABCDF';

/** the grade the top bar shows, as its place in A…F (lower is better) */
async function grade(page: Page): Promise<number> {
  const label = (await gradeButton(page).getAttribute('aria-label')) ?? (await gradeButton(page).innerText());
  return GRADES.indexOf(/grade ([A-F])/.exec(label)?.[1] ?? '?');
}

test('a risky rule: the grade and its finding, a fix into the code, the lens, and the rules editor round trip', async ({ page }) => {
  await page.addInitScript((text) => {
    if (localStorage.getItem('cb-projects-v1')) return;
    const now = new Date().toISOString();
    localStorage.setItem('cb-seeded-v1', '1');
    localStorage.setItem('cb-tips-dismissed', '1');
    localStorage.setItem(
      'cb-projects-v1',
      JSON.stringify([{ id: 'prj_risky', name: 'risky-web', files: { 'main.tf': text }, providers: [], createdAt: now, updatedAt: now }]),
    );
  }, RISKY);
  await page.goto('/editor/prj_risky');
  await expect(canvasStats(page)).toBeVisible();

  // SSH open to the internet: a poor grade, and the finding that says why
  await expect(gradeButton(page)).toBeVisible();
  const before = await grade(page);
  expect(before).toBeGreaterThanOrEqual(GRADES.indexOf('C'));
  await gradeButton(page).click();
  const panel = page.getByRole('complementary', { name: 'Security' });
  const ssh = panel.locator('[data-severity="critical"]', { hasText: 'SSH (port 22) is open to the internet' });
  await expect(ssh).toBeVisible();

  // the lens: the internet and what it reaches, port by port
  await panel.getByRole('switch', { name: 'Security lens' }).check();
  await expect(node(page, '__internet__')).toBeVisible();
  const labels = page.locator('.react-flow__edgelabel-renderer > div');
  await expect(labels.filter({ hasText: ':22' })).toHaveCount(1);
  await expect(labels.filter({ hasText: ':443' })).toHaveCount(1);

  // its fix: the rule narrowed in the code, the finding gone, a better grade, SSH off the lens
  await ssh.getByRole('button', { name: /Restrict to 10\.0\.0\.0\/16/ }).click();
  await expect.poll(() => mainTf(page)).toMatch(/from_port\s+= 22[\s\S]*?cidr_blocks = \["10\.0\.0\.0\/16"\]/);
  expect(await mainTf(page)).toMatch(/from_port\s+= 443[\s\S]*?cidr_blocks = \["0\.0\.0\.0\/0"\]/);
  await expect(ssh).toHaveCount(0);
  await expect.poll(() => grade(page)).toBeLessThan(before);
  await expect(labels.filter({ hasText: ':22' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close security panel' }).click();
  await expect(panel).toBeHidden();

  // the rules editor: HTTPS moved to 8443 is one line of the code, and the lens follows
  await node(page, 'aws_security_group.web').click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Edit rules' }).click();
  const dialog = page.getByRole('dialog', { name: /^Rules for/ });
  const https = dialog.locator('tr[data-rule="aws_security_group.web:ingress:1"]').getByRole('textbox', { name: 'Port range' });
  await expect(https).toHaveValue('443');
  await https.fill('8443');
  await https.press('Enter');
  await expect.poll(() => mainTf(page)).toMatch(/from_port\s+= 8443\n\s+to_port\s+= 8443/);
  expect(await mainTf(page)).not.toMatch(/= 443\b/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(labels.filter({ hasText: ':8443' })).toHaveCount(1);

  // and back: one undo restores the code, the lens and what the editor shows
  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page)).toMatch(/from_port\s+= 443\n\s+to_port\s+= 443/);
  await expect(labels.filter({ hasText: ':443' })).toHaveCount(1);
  await node(page, 'aws_security_group.web').click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Edit rules' }).click();
  await expect(dialog.locator('tr[data-rule="aws_security_group.web:ingress:1"]').getByRole('textbox', { name: 'Port range' })).toHaveValue('443');
});
