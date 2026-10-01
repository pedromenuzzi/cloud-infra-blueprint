/**
 * Security: the rules editor and the audit panel, end to end — every edit
 * must land in the Terraform with the semantics the UI showed.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, storedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page, name: string) => (await storedProject(page, name))?.files['main.tf'] ?? '';

/** open a project built from this HCL (fresh context = fresh localStorage) */
async function openProject(page: Page, name: string, mainTfText: string) {
  const id = `prj_${name}`;
  await page.addInitScript(
    ({ id, name, text }) => {
      if (localStorage.getItem('cb-projects-v1')) return;
      const now = new Date().toISOString();
      localStorage.setItem('cb-seeded-v1', '1');
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem(
        'cb-projects-v1',
        JSON.stringify([{ id, name, files: { 'main.tf': text }, providers: [], createdAt: now, updatedAt: now }]),
      );
    },
    { id, name, text: mainTfText },
  );
  await page.goto(`/editor/${id}`);
  await expect(canvasStats(page)).toBeVisible();
}

async function openRules(page: Page, owner: string) {
  await node(page, owner).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Edit rules' }).click();
  return page.getByRole('dialog', { name: /^Rules for/ });
}

const SSH_ONLY = `
resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.web.id]

  metadata_options {
    http_tokens = "required"
  }
}
`;

test('deleting the last inbound rule writes `ingress = []`, so the rule really goes away', async ({ page }) => {
  await openProject(page, 'last-rule', SSH_ONLY);
  await expect(page.getByRole('button', { name: /^Security grade C/ })).toBeVisible();

  const dialog = await openRules(page, 'aws_security_group.web');
  await dialog.locator('tr[data-rule="aws_security_group.web:ingress:0"]').getByRole('button', { name: 'Delete rule' }).click();
  await expect(dialog.getByText('No inbound rules: nothing can connect to resources in this group.')).toBeVisible();
  await expect.poll(() => mainTf(page, 'last-rule')).toMatch(/ingress\s*=\s*\[\]/);
  await expect(page.getByRole('button', { name: /^Security grade A/ })).toBeVisible();

  // one undo brings the rule back
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page, 'last-rule')).toMatch(/ingress \{[^}]*from_port\s*=\s*22/);
});

test('rows written with expressions are read-only and point to the code', async ({ page }) => {
  await openProject(page, 'expr-row', SSH_ONLY.replace('from_port   = 22', 'from_port   = var.port').replace('to_port     = 22', 'to_port     = var.port'));
  const dialog = await openRules(page, 'aws_security_group.web');
  const row = dialog.locator('tr[data-rule="aws_security_group.web:ingress:0"]');
  await expect(row.getByRole('textbox', { name: 'Port range' })).toBeDisabled();
  await expect(row.getByRole('textbox', { name: 'Port range' })).toHaveValue('var.port');
  await expect(row.getByRole('button', { name: 'Delete rule' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Edit in code' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-testid="monaco"] .view-line', { hasText: 'var.port' }).first()).toBeVisible();
});

const FIXABLE = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
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
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_security_group" "legacy" {
  name   = "legacy"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 3389
    to_port     = 3389
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.web.id, aws_security_group.legacy.id]
}
`;

test('fix all applies every fix as one undo step and counts only what it fixed', async ({ page }) => {
  await openProject(page, 'fix-all', FIXABLE);
  await page.getByRole('button', { name: /^Security grade/ }).click();
  const panel = page.getByRole('complementary', { name: 'Security' });
  await expect(panel).toBeVisible();

  // it never covers the canvas stats pill
  const pill = await canvasStats(page).boundingBox();
  const box = await panel.boundingBox();
  expect(pill!.y + pill!.height <= box!.y || pill!.x >= box!.x + box!.width).toBe(true);

  // the IPv4 and IPv6 SSH rules are two distinguishable findings; RDP on an unknown VPC has no fix
  await expect(panel.locator('[data-severity="critical"]')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Fix all 3' }).click();
  await expect(page.getByText('Fixed 3 issues. Ctrl+Z to undo')).toBeVisible();

  await expect.poll(() => mainTf(page, 'fix-all')).not.toContain('::/0');
  const text = await mainTf(page, 'fix-all');
  expect(text).toMatch(/cidr_blocks\s*=\s*\["10\.0\.0\.0\/16"\]/);
  expect(text).not.toContain('::/0');
  expect(text.match(/ingress \{/g)).toHaveLength(2);
  expect(text).toMatch(/http_tokens\s*=\s*"required"/);
  await expect(panel.getByText('RDP (port 3389) is open to the internet')).toBeVisible();

  // Esc closes the panel
  await panel.getByRole('button', { name: /RDP \(port 3389\)/ }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page, 'fix-all')).toContain('ipv6_cidr_blocks = ["::/0"]');
});

test('GCP: switching a firewall from allow to deny is one undo step', async ({ page }) => {
  await openProject(
    page,
    'gcp-toggle',
    `
resource "google_compute_network" "vpc" {
  name = "vpc"
}

resource "google_compute_firewall" "web" {
  name          = "web"
  network       = google_compute_network.vpc.id
  source_ranges = ["10.0.0.0/8"]

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}
`,
  );
  const dialog = await openRules(page, 'google_compute_firewall.web');
  await dialog.getByRole('combobox', { name: 'Action' }).selectOption('deny');
  await expect.poll(() => mainTf(page, 'gcp-toggle')).toMatch(/deny \{/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page, 'gcp-toggle')).toMatch(/allow \{/);
  expect(await mainTf(page, 'gcp-toggle')).not.toMatch(/deny \{/);
});

test('Azure: the priority input is validated and follows undo', async ({ page }) => {
  await openProject(
    page,
    'nsg-priority',
    `
resource "azurerm_network_security_group" "web" {
  name                = "web"
  location            = "eastus"
  resource_group_name = "rg"

  security_rule {
    name                       = "https"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}
`,
  );
  const dialog = await openRules(page, 'azurerm_network_security_group.web');
  const priority = dialog.getByRole('textbox', { name: 'Priority' });
  // an empty value is rejected, not written as 0
  await priority.fill('');
  await expect(priority).toHaveAttribute('aria-invalid', 'true');
  await priority.press('Enter');
  await expect(priority).toHaveValue('100');
  await priority.fill('200');
  await priority.press('Enter');
  await expect.poll(() => mainTf(page, 'nsg-priority')).toMatch(/priority\s*=\s*200/);
  await page.getByRole('heading', { name: /Rules · web/ }).click();
  await page.keyboard.press('Control+z');
  await expect(priority).toHaveValue('100');
});
