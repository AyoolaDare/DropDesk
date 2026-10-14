// S1 end-to-end smoke against a running app: sign up → create business → add dispatcher → audit verified.
// Usage: BASE_URL=http://localhost:3000 node tests/e2e/smoke.mjs [screenshotDir]
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const shots = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const stamp = Date.now();
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

async function signUp(page, name, email) {
  await page.goto(`${base}/login`);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-strong-passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(`${base}/`);
}

// Dispatcher account first (members must exist before they're added in S1).
const dctx = await browser.newContext();
await signUp(await dctx.newPage(), 'Jide Dispatch', `jide.${stamp}@example.ng`);

for (const [w, h] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  // Unauthenticated → login
  await page.goto(base);
  if (!page.url().endsWith('/login')) fail(`expected redirect to /login, got ${page.url()}`);
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: `${shots}/s1-login-${w}.png`, fullPage: true });

  // Validation feedback is text + icon, never colour alone
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Bisi Okafor');
  await page.getByLabel('Email').fill(`bisi.${w}.${stamp}@example.ng`);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('form [role=alert]').waitFor();
  if (!(await page.getByText('Use at least 10 characters.').isVisible())) fail('password rule message not shown');
  if (shots) await page.screenshot({ path: `${shots}/s1-signup-error-${w}.png`, fullPage: true });
  await page.getByLabel('Password').fill('a-strong-passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(`${base}/`);

  // Create business (owner)
  await page.getByLabel('Business name').fill("Bisi's Kitchen");
  await page.getByPlaceholder('bisis-kitchen').fill(`bisis-kitchen-${w}-${String(stamp).slice(-5)}`);
  await page.getByRole('button', { name: 'Create business' }).click();
  await page.getByRole('heading', { name: 'Team' }).waitFor();

  // Add the dispatcher
  await page.getByPlaceholder('teammate@business.ng').fill(`jide.${stamp}@example.ng`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Member added.').waitFor();
  await page.reload();
  if (!(await page.getByText(/Chain verified · \d+ events/).isVisible())) fail('audit chain badge not verified');
  if (!(await page.getByText('membership.created').isVisible())) fail('audit event missing');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) fail(`horizontal scroll at ${w}px`);
  if (shots) await page.screenshot({ path: `${shots}/s1-workspace-${w}.png`, fullPage: true });
  console.log(`PASS ${w}px: redirect, validation, sign-up, create business, add dispatcher, audit verified, no overflow`);
  await ctx.close();
}
await browser.close();
