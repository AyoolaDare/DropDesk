// Cross-device + layout-stability check for the DropDesk workspace.
// Usage: node scripts/check-workspace.mjs [outDir]   (CHROMIUM_PATH defaults to /opt/pw-browsers/chromium)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.DD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, 'screenshots'));
mkdirSync(out, { recursive: true });
const url = pathToFileURL(resolve(root, 'index.html')).href;
const widths = [360, 768, 1440, 1920];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let failed = 0;

const boxes = (p) => p.evaluate(() => [...document.querySelectorAll('main section, main article')]
  .map((el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y + scrollY), Math.round(b.width), Math.round(b.height)]; }));

for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 780 : 900 } });
  const p = await ctx.newPage();
  const problems = [];

  // 1) Skeleton state, held open with ?loading
  await p.goto(url + '?loading', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const before = await boxes(p);
  await p.screenshot({ path: resolve(out, `workspace-${w}-loading.png`), fullPage: true });

  // 2) Loaded state: same boxes or it's a layout shift
  await p.evaluate(() => document.body.removeAttribute('data-loading'));
  const after = await boxes(p);
  const moved = before.map((b, i) => b.join() !== after[i]?.join() ? i : -1).filter((i) => i >= 0);
  if (moved.length) problems.push(`layout shift on load in ${moved.length} card(s): ${moved.map((i) => `${before[i]}→${after[i]}`).join('; ')}`);

  const r = await p.evaluate((touch) => {
    const vw = innerWidth;
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]') && !el.closest('.sr-only') && !el.classList.contains('sr-only'); };
    const off = [...document.querySelectorAll('main *, header *')].filter(vis)
      .filter((el) => !el.closest('[class*="overflow-x-auto"]'))
      .filter((el) => { const b = el.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; })
      .slice(0, 4).map((el) => el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.'));
    const small = !touch ? [] : [...document.querySelectorAll('main a, main button, main input, header a, header button, header input')].filter(vis)
      .filter((el) => { const h = el.getBoundingClientRect().height; const min = el.className.includes('min-h-[36px]') ? 36 : (el.closest('[data-pipeline-link]') ? 0 : 44); return h < min - 0.5; })
      .filter((el) => !/^\+ \d+ more$|^All deliveries$|^Rider directory$/.test(el.textContent.trim()))
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`);
    return { sw: document.documentElement.scrollWidth, vw, off, small };
  }, w < 1024);
  if (r.sw > r.vw) problems.push(`horizontal scroll ${r.sw}px > ${r.vw}px`);
  if (r.off.length) problems.push(`off-screen: ${r.off.join(', ')}`);
  if (r.small.length) problems.push(`tap targets < 44px: ${r.small.join('; ')}`);
  await p.screenshot({ path: resolve(out, `workspace-${w}.png`), fullPage: true });

  // 3) Job sheet opens fully on-screen
  await p.click('[data-job="DD-24817"][data-name]');
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => { const b = document.getElementById('job-sheet').getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, vw: innerWidth, vh: innerHeight }; });
  if (sheet.l < -1 || sheet.r > sheet.vw + 1 || sheet.b > sheet.vh + 1) problems.push(`job sheet off-screen ${JSON.stringify(sheet)}`);
  await p.screenshot({ path: resolve(out, `workspace-${w}-sheet.png`) });

  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${String(w).padStart(4)}px  ${before.length} cards stable=${!moved.length}${problems.length ? '\n      ' + problems.join('\n      ') : ''}`);
  failed += problems.length ? 1 : 0;
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} width(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
