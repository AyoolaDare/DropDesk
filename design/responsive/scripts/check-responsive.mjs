// Cross-device check for the DropDesk responsive screens.
// Usage: node scripts/check-responsive.mjs [outDir]
// Needs playwright-core and a Chromium (set CHROMIUM_PATH, default /opt/pw-browsers/chromium).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, 'screenshots'));
mkdirSync(out, { recursive: true });

const pages = ['dashboard', 'create-delivery', 'job-details'];
const viewports = [
  { name: 'mobile', width: 360, height: 780, tier: 'mobile' },
  { name: 'tablet', width: 768, height: 1024, tier: 'tablet' },
  { name: 'laptop', width: 1440, height: 900, tier: 'laptop' },
  { name: 'wide', width: 1920, height: 1080, tier: 'laptop' },
];
// Sidebar width the shell must have at each tier (0 = hidden).
const SIDEBAR = { mobile: 0, tablet: 80, laptop: 256 };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let failures = 0;

for (const page of pages) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(resolve(root, `${page}.html`)).href, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);

    const r = await p.evaluate(({ tier }) => {
      const vw = window.innerWidth;
      const visible = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden'; };
      const overflowers = [...document.querySelectorAll('body *')]
        .filter((el) => visible(el) && !el.closest('[class*="overflow-x-auto"]') && !el.closest('.sr-only'))
        .filter((el) => { const b = el.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; })
        .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
      const aside = document.querySelector('aside.sticky')?.parentElement; // sidebar column
      const bottom = document.querySelector('body > div > nav.fixed, body > div > div.fixed');
      // Tap targets: 44x44 on touch tiers. Inline links inside running text and the 36px filter/quick-add chips are allowed.
      const small = tier === 'laptop' ? [] : [...document.querySelectorAll('a, button, summary, select, input:not([type=radio]), textarea')]
        .filter(visible)
        .filter((el) => !el.closest('p') && !el.closest('nav[aria-label=Breadcrumb]') && !el.classList.contains('sr-only'))
        .filter((el) => { const b = el.getBoundingClientRect(); const minH = el.className.includes('min-h-[36px]') ? 36 : 44; return b.height < minH - 0.5; })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`);
      return {
        scrollWidth: document.documentElement.scrollWidth, vw,
        overflowers,
        sidebar: aside && visible(aside) ? Math.round(aside.getBoundingClientRect().width) : 0,
        bottomBar: !!(bottom && visible(bottom)),
        small,
      };
    }, { tier: vp.tier });

    const problems = [];
    if (r.scrollWidth > r.vw) problems.push(`horizontal scroll: ${r.scrollWidth}px > ${r.vw}px`);
    if (r.overflowers.length) problems.push(`off-screen: ${r.overflowers.join(', ')}`);
    if (r.sidebar !== SIDEBAR[vp.tier]) problems.push(`sidebar ${r.sidebar}px, expected ${SIDEBAR[vp.tier]}px`);
    if (r.bottomBar !== (vp.tier === 'mobile')) problems.push(`bottom bar ${r.bottomBar ? 'shown' : 'hidden'} at ${vp.name}`);
    if (r.small.length) problems.push(`tap targets under 44px: ${r.small.join('; ')}`);

    // Full-page captures: pin fixed bars to the page bottom so they don't float mid-image.
    await p.addStyleTag({ content: 'body{position:relative} body > div > .fixed{position:absolute}' });
    await p.screenshot({ path: resolve(out, `${page}-${vp.width}.png`), fullPage: true });
    console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${page.padEnd(16)} ${String(vp.width).padStart(4)}px  sidebar=${r.sidebar} bottomBar=${r.bottomBar}${problems.length ? '\n      ' + problems.join('\n      ') : ''}`);
    failures += problems.length ? 1 : 0;
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} viewport check(s) failed` : '\nAll viewport checks passed');
process.exit(failures ? 1 : 0);
