/**
 * The learning map (/learn) and the bridges between the two doors: the map
 * with its start question, "Start here", continue, reset and the phone list;
 * a celebration that never takes focus; the landing page's doors, the rail,
 * ⌘K, the dashboard card, the inspector's "Learn about this"; and the old
 * tutorial links.
 *
 * The lessons are read off the map itself (the lesson modules check their
 * goals with code that only runs in the app), so these hold whatever lessons
 * the levels have.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { allBadges } from '../src/learn/gamification';
import { encodeShare } from '../src/lib/share';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** the page is at this path (whatever the base URL) */
const at = (path: string) => new RegExp(`${escape(path)}$`);

/** the stations of the AWS track, in order: links named "<code> <title>. <kind>. <state>. <minutes>, <XP>" */
const stations = (page: Page) => page.locator('[data-track="aws"] [data-station] > a');

interface Station {
  code: string;
  slug: string;
  name: string;
  link: Locator;
}

/** the first station of the map, read from the page */
async function firstStation(page: Page): Promise<Station> {
  const link = stations(page).first();
  const code = (await page.locator('[data-track="aws"] [data-station]').first().getAttribute('data-station'))!;
  const slug = (await link.getAttribute('href'))!.replace(/^.*\/learn\//, '');
  const name = (await link.getAttribute('aria-label'))!;
  return { code, slug, name, link };
}

/** progress as the app stores it, then a reload so the app reads it */
async function store(page: Page, progress: object) {
  await page.evaluate((p) => localStorage.setItem('cb-learn-v1', JSON.stringify(p)), progress);
  await page.reload();
}

test('the map draws every level, its lessons and badges, and asks where to start without blocking', async ({ page }) => {
  await page.goto('/learn');
  await expect(page).toHaveTitle('Learning map · Cloud Blueprint');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn Terraform, one station at a time');
  // first visit: the question is up front, and the map is right there with it
  await expect(page.getByRole('radiogroup', { name: 'Where do you start?' }).getByRole('radio')).toHaveCount(2);
  const first = await firstStation(page);
  await expect(page.getByRole('link', { name: /^Start here/ })).toHaveAttribute('href', at(`/learn/${first.slug}`));

  await expect(page.getByRole('heading', { name: 'Terraform on AWS', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Azure (preview)', level: 2 })).toBeVisible();
  const islands = page.locator('[data-level]');
  const levels = await islands.count();
  expect(levels).toBeGreaterThanOrEqual(5);
  for (const island of await islands.all()) {
    await expect(island.getByRole('heading', { level: 3 })).toBeVisible();
    const links = island.locator('[data-station] > a');
    if ((await links.count()) === 0) {
      await expect(island.getByText('The lessons of this level are on the way.')).toBeVisible();
      continue;
    }
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('href', /\/learn\/[\w-]+$/);
      await expect(link).toHaveAccessibleName(/Not started\. \d+ min, \d+ XP$/);
    }
  }

  const card = page.getByTestId('player-card');
  await expect(card.getByText('Newcomer')).toBeVisible();
  await expect(card.getByText('100 XP to Apprentice')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Badges', level: 2 })).toBeVisible();
  // the command and effort badges, and one per level
  await expect(page.locator('[data-badge]')).toHaveCount(allBadges([]).length + levels);
});

test('the start choice moves "Start here" and makes AWS basics optional; nothing is locked', async ({ page }) => {
  await page.goto('/learn');
  const names = () => stations(page).evaluateAll((links) => links.map((a) => a.getAttribute('aria-label')!));

  await page.getByText('I know AWS, new to Terraform').click();
  await expect(page.getByRole('radio', { name: /I know AWS/ })).toBeChecked();
  await expect(page.getByRole('link', { name: /\. Start here\./ })).toHaveCount(1);
  // "Start here" is on the first lesson that isn't AWS basics (marked optional now)
  let all = await names();
  expect(all.find((n) => !n.includes('. Optional.'))).toContain('. Start here.');

  await page.getByText('New to AWS and Terraform').click();
  await expect(page.getByRole('radio', { name: /New to AWS/ })).toBeChecked();
  all = await names();
  expect(all[0]).toContain('. Start here.');
  expect(all.filter((n) => n.includes('. Optional.'))).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cb-learn-v1')!).start)).toBe('new');

  // every station is a plain link, whatever was chosen
  const last = stations(page).last();
  const href = (await last.getAttribute('href'))!;
  await last.click();
  await expect(page).toHaveURL(at(href));
});

test('continue where you left off: on the map and, kept small, on the dashboard', async ({ page }) => {
  await page.goto('/learn');
  const first = await firstStation(page);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Continue your trail' })).toHaveCount(0);

  await store(page, { start: 'new', lessons: { [first.slug]: { status: 'started', met: [] } }, last: first.slug });
  const trail = page.getByRole('region', { name: 'Continue your trail' });
  await expect(trail).toContainText(first.code);
  // the build side stays free of the game: no XP, no rank
  await expect(trail).not.toContainText('XP');
  await trail.getByRole('link', { name: new RegExp(`^Continue lesson ${escape(first.code)} `) }).click();
  await expect(page).toHaveURL(at(`/learn/${first.slug}`));

  await page.goto('/learn');
  await expect(page.getByRole('link', { name: /^Continue where you left off/ })).toHaveAttribute('href', at(`/learn/${first.slug}`));
  await expect(first.link).toHaveAccessibleName(/\. (Start here|You are here)\./);
});

test('reset progress asks first, then forgets everything', async ({ page }) => {
  await page.goto('/learn');
  const first = await firstStation(page);
  await store(page, {
    start: 'aws',
    xp: 120,
    lessons: { [first.slug]: { status: 'done', met: [], xp: 40 } },
    badges: { 'first-init': '2026-10-15' },
    last: first.slug,
  });
  const card = page.getByTestId('player-card');
  await expect(card.getByText('Apprentice')).toBeVisible();
  await expect(first.link).toHaveAccessibleName(/\. Done, 40 XP earned\./);
  await expect(page.locator('[data-badge="first-init"]')).toContainText('Earned Oct 15, 2026');

  await page.getByRole('button', { name: 'Reset progress' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Reset your learning progress?' });
  await expect(confirm).toContainText('Your projects are not touched.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByText('Apprentice')).toBeVisible();

  await page.getByRole('button', { name: 'Reset progress' }).click();
  await confirm.getByRole('button', { name: 'Reset progress' }).click();
  await expect(page.getByText('Learning progress reset')).toBeVisible();
  await expect(card.getByText('Newcomer')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Where do you start?' }).getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(first.link).toHaveAccessibleName(/\. Not started\./);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cb-learn-v1')!))).toMatchObject({ xp: 0, start: null, lessons: {}, badges: {} });
});

test('a badge earned on the map is celebrated and read out, without taking focus', async ({ page }) => {
  await page.goto('/learn');
  // `terraform init` already ran in a lesson, its badge not given yet: the next change awards it
  await store(page, { runs: { 'some-lesson': ['init'] } });
  const cheers = page.getByTestId('celebrations');
  await expect(cheers).toBeAttached();
  await page.getByText('I know AWS, new to Terraform').click();

  await expect(cheers.locator('[data-cheer="badge"]')).toContainText('Badge unlocked');
  await expect(cheers.locator('[data-cheer="badge"]')).toContainText('Initialized');
  await expect(cheers.locator('[aria-live="polite"]')).toHaveText('Badge unlocked: Initialized.');
  // the answer swapped the cards for the compact switch: focus followed to the same choice
  await expect(page.getByRole('radio', { name: /I know AWS/ })).toBeFocused();
  // gone by itself, and the shelf now shows it earned
  await expect(cheers.locator('[data-cheer]')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('[data-badge="first-init"]')).toContainText('Earned');
});

test('old tutorial links land on the lessons that replaced them', async ({ page }) => {
  for (const [from, to] of [
    ['/tutorials', '/learn'],
    ['/tutorials/first-vpc-ec2?step=3', '/learn/your-vpc'],
    ['/tutorials/static-site-cdn', '/learn/s3-bucket-tags'],
    ['/tutorials/refs-become-connections', '/learn/references'],
    ['/tutorials/azure-nesting', '/learn/azure-resource-groups'],
    ['/tutorials/no-such-tutorial', '/learn'],
  ]) {
    await page.goto(from);
    await expect(page, from).toHaveURL(at(to));
  }
});

test('the landing page offers two doors, and presents the learning map', async ({ page }) => {
  await page.goto('/');
  const doors = page.getByRole('navigation', { name: 'Choose how to start' });
  await doors.getByRole('link', { name: /^Build my infrastructure/ }).click();
  await expect(page).toHaveURL(at('/dashboard'));
  await page.goBack();
  await doors.getByRole('link', { name: /^Learn Terraform/ }).click();
  await expect(page).toHaveURL(at('/learn'));
  await page.goBack();

  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn', exact: true })).toHaveAttribute('href', at('/learn'));
  await expect(page.getByRole('heading', { name: 'Learn Terraform by building it', level: 2 })).toBeVisible();
  await page.getByRole('link', { name: 'Open the learning map' }).click();
  await expect(page).toHaveURL(at('/learn'));
});

test('the rail and ⌘K lead to the map and to any lesson by its title', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page).toHaveURL(at('/learn'));
  const first = await firstStation(page);
  // "<code> <title>. …": the title is what the palette finds it by
  const title = first.name.slice(first.code.length + 1, first.name.indexOf('. ', first.code.length + 1));

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill(title);
  await palette.getByRole('option', { name: `${first.code} ${title}` }).click();
  await expect(page).toHaveURL(at(`/learn/${first.slug}`));

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill('learning map');
  await palette.getByRole('option', { name: 'Open learning map' }).click();
  await expect(page).toHaveURL(at('/learn'));
});

test('the inspector links a resource to the lesson that teaches it', async ({ page }) => {
  // the S3 bucket is the first resource the map teaches
  const files = { 'main.tf': 'resource "aws_s3_bucket" "learned" {\n}\n' };
  await page.goto(`/#view=${encodeShare({ name: 'learn', files })}`);
  const node = page.locator('.react-flow__node[data-id="aws_s3_bucket.learned"]');
  await expect(node).toBeVisible({ timeout: 15_000 });
  await node.click({ position: { x: 16, y: 10 } });
  const link = page.getByRole('complementary', { name: 'Inspector' }).getByRole('link', { name: 'Learn about this' });
  await expect(link).toHaveAttribute('title', /^Lesson \S+: /);
  await link.click();
  await expect(page).toHaveURL(/\/learn\/[\w-]+$/);
});

test.describe('on a phone (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('each level is an ordered list, top to bottom, and nothing scrolls sideways', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const island of await page.locator('[data-level]').all()) {
      const lessons = await island.locator('[data-station]').count();
      if (lessons === 0) continue;
      // the level's badge closes the trail on screen; its state is read out in the level's header
      const items = island.locator('ol').getByRole('listitem');
      await expect(items).toHaveCount(lessons);
      const boxes = await Promise.all((await items.all()).map((item) => item.boundingBox()));
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
        expect(Math.abs(boxes[i]!.x - boxes[0]!.x)).toBeLessThan(1);
      }
      // the drawn trail is a wide-screen decoration
      await expect(island.locator('svg[data-trail]')).toBeHidden();
    }
    const sideways = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(sideways).toBeLessThanOrEqual(0);
  });
});
