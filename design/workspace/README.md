# DropDesk merchant workspace

The workspace page (`index.html`) as an asymmetric bento grid in light mode. Neutrals do most of the work; the one accent is **#006652**.

| Card | Columns at laptop | Mobile (360) | Tablet (768) |
|---|---|---|---|
| Exception banners (rider no-show, address incomplete) | 2 × 6 | stacked | 2-up |
| Today's delivery pipeline (hero) | 8 | stages stacked | stages 2×2 |
| KPI widgets: on-time rate, accepted-job completion, active exceptions | 4 (stacked) | stacked | 3 across |
| Rider supply (status + rolling 30-day reliability) | 7 | rows wrap the score under the name | full width |
| NIPOST address resolver | 5 | full width | full width |

## Design rules

- **Gradient** in exactly two places: the *Create New Delivery Job* button (`bg-anchor-cta`, 120°) and a faint radial glow behind the KPI group (`bg-kpi-glow`).
- **Glass** (`.glass` = `bg-white/70 backdrop-blur-md`, `border-black/5`) only on the sticky top bar, the mobile nav sheet, and the job side sheet. That sheet is a bottom sheet on mobile and a 420px right drawer from 768px up.
- **Motion:** buttons use `.press` (`transition-all duration-200`, `active:scale-95`). Large cards use `.press-card` (`active:scale-[0.98]`), because 95% on a 600px card reads as a jolt. All motion is turned off under `prefers-reduced-motion`.
- **Cards:** `rounded-2xl p-6 bg-white ring-1 ring-black/5` with a 1px hairline shadow. No heavy shadows.
- **Pipeline colours:** pending `#94A3B8`, transit `#475569`, attention `#D9480F`, delivered `#006652`. Every adjacent pair passed colour-blind and normal-vision separation checks. A red attention segment next to the green failed for protanopia (red-blind viewers), so attention uses orange-red; exception banners keep red borders. Every stage also has an icon and a text label.
- **No layout shift:** skeletons share the same grid cell as the real content (`.stack > *` uses `grid-area: 1/1`), and inline values become same-size pulse bars (`.ld`). The check script measures every card in both states and fails if any box moves.
- **NIPOST:** the format check runs on the device (11 letters or digits, uppercase, spaces removed). It drives 11 progress ticks and a "Format valid / invalid" pill. *Resolve* stays disabled until the format passes. A switch reveals manual address, landmark and gate fields. The resolve response in this prototype is a stub.

## Build & check

```bash
npx tailwindcss@3.4.17 -c tailwind.config.js -i src/input.css -o dist/workspace.css --minify
npm i -D playwright-core && node scripts/check-workspace.mjs
```
The check runs at 360, 768, 1440 and 1920 px. It covers horizontal overflow, 44 px tap targets (36 px filter chips allowed), skeleton→loaded layout stability, and whether the job sheet opens fully on-screen. Add `?loading` to the URL to hold the skeleton state.
