# DropDesk responsive UI: architecture & wireframes

Three core screens are built as production-shaped Tailwind HTML, with a check script that renders them at 360 / 768 / 1440 / 1920 px:

| File | Screen |
|---|---|
| `dashboard.html` | UI-03 Dashboard (command centre) |
| `create-delivery.html` | UI-05 Create / edit delivery (data intake) |
| `job-details.html` | UI-09 Job details & immutable timeline (operations ledger) |
| `tailwind.config.js`, `src/input.css` | Tokens + component classes (`.panel`, `.badge-*`, `.btn-*`, `.field`, `.tap`) |
| `dist/dropdesk.css` | Compiled, minified CSS (~28 KB, ~6 KB gzipped) |
| `scripts/check-responsive.mjs` | Cross-device check + full-page screenshots |

```bash
npx tailwindcss@3.4.17 -c tailwind.config.js -i src/input.css -o dist/dropdesk.css --minify
npm i -D playwright-core && node scripts/check-responsive.mjs   # writes screenshots/
```

The check fails a viewport on any horizontal scroll, any element off-screen, the wrong navigation for the tier (no sidebar + bottom bar on mobile; 80 px icon rail on tablet; 256 px sidebar on laptop) or a touch target under 44 px on mobile/tablet (36 px allowed only for filter/quick-add chips).

---

## 1. Breakpoint system

| Tier | Tailwind | Width | Navigation | Content grid | Type |
|---|---|---|---|---|---|
| Mobile | base | 360–767 | Top bar + **bottom tab bar** (`fixed`, `md:hidden`); form/detail screens swap tabs for a sticky action bar | 1 column, full-width cards, 16 px gutter | meta `text-xs`, body `text-sm`, inputs 16 px (stops Android zoom) |
| Tablet | `md:` | 768–1023 | **Icon rail** `md:w-20`, labels `sr-only` + `title` | 2-column panels (`md:grid-cols-2`) | meta `md:text-sm` |
| Laptop | `lg:` | 1024–1535 | **Full sidebar** `lg:w-64` with grouped labels | Main + right rail (`lg:grid-cols-[minmax(0,1fr)_340px]`) | — |
| Wide | `2xl:` | 1536–1920 | Same | Content capped at `max-w-[1680px]`; dashboard pipeline becomes 4 kanban columns | — |

Rules that make it hold at 360 px (each found by the check script):
- Use `grid-cols-1` explicitly on mobile grids. An implicit `auto` track grows to its widest child's min-content and pushes the page sideways.
- `fieldset { min-width: 0 }`: fieldsets default to `min-content` width.
- `[hidden] { display: none !important }`: otherwise a `flex` class un-hides a hidden state panel.

Colour tokens: `surface` #F8FAFC (slate-50), panels #FFFFFF, `ink` #0F172A (slate-900), `verified` #15803D (green-700), `attention` #B45309 (amber-700), `transit` #1D4ED8, `danger` #B91C1C. Every status pairs colour with an icon **and** a word.

Localisation: money is stored as integer kobo and shown as `₦5,500.00` (`Intl.NumberFormat('en-NG', {currency:'NGN'})`). Times are stored UTC and shown in `Africa/Lagos` with "WAT" in page headers. Requested windows say "requested" until a rider accepts.

---

## 2. The 16-screen system index

| # | Screen | Primary user | Mobile (360) | Tablet (768) | Laptop (1440) |
|---|---|---|---|---|---|
| UI-01 | Login / sign-up | Everyone | Single card, OTP 6 boxes, resend timer ("Resend in 0:45"), terms checkbox | Centred card `max-w-md` | Split: card + product panel |
| UI-02 | Merchant setup wizard | Owner | 1 step per screen, progress "Step 2 of 5", save & resume | Same, wider fields 2-up | Steps rail left + form; CSV preview table |
| **UI-03** | **Dashboard** | Owner, dispatcher | **Built:** see §3 | | |
| UI-04 | Delivery list | Owner, dispatcher | Cards, filter sheet, "Load more" (cursor) | Cards 2-up or condensed table | Full table, sticky header, column filters, cursor pager |
| **UI-05** | **Create / edit delivery** | Owner, dispatcher | **Built:** see §4 | | |
| UI-06 | Rider directory | Owner | Rider cards with 30/90-day toggle, sample size, favourite/block | 2-up cards | Table + detail drawer |
| UI-07 | Rider application | Rider | Step flow, camera/file upload, consent, status + appeal | Same | Centred `max-w-2xl` |
| UI-08 | Rider job inbox | Rider | Offer cards: window, pay ₦, distance, accept/reject, conflict warning, expiry countdown | 2-up | List + offer detail |
| **UI-09** | **Job details & timeline** | Owner, dispatcher, rider (role-filtered) | **Built:** see §5 | | |
| UI-10 | Proof of delivery | Rider | PIN pad, recipient name, optional photo, GPS notice, "Saved offline · will sync" | Same | (rider tool; desktop read-only) |
| UI-11 | Exceptions & disputes | Owner, support | Case card, reason catalogue, evidence upload, attribution status (unreviewed → provisional → confirmed / disputed) | 2 columns: case + evidence | Queue + case workspace + decision audit |
| UI-12 | Reports | Owner | Stat tiles + 1 chart per screen, date range sheet, CSV link | 2-up charts | Filter bar + chart grid + metric definitions |
| UI-13 | Billing & plan | Owner | Current plan, limits, provider checkout link, invoices | Same | Plan comparison 3-up |
| UI-14 | Admin console | Platform admin | Search + incident queue (read-mostly) | Rail + list | Global search, queues, feature flags/kill switches with confirm + reason |
| UI-15 | Public tracking | Recipient | **No app shell**, under 30 KB, status + window + rider first name, PIN entry, expiry copy | Same, centred | Same, centred |
| UI-16 | System status / settings | Owner, admin | Provider health list with last success time | 2-up | Health grid + webhook latency table + retention settings |

Navigation map (sidebar groups ↔ mobile tabs):

```
Sidebar (lg)                 Icon rail (md)   Bottom tabs (base)
OPERATIONS  Today            ⌂                Today
            Deliveries       ≡                Deliveries
            Exceptions (2)   ⚠                [ + New ]
DISPATCH    Rider directory  👥               Riders
            Offers & inbox   ▭                More → Offers, Exceptions, Reports,
BUSINESS    Reports          ▥                        Billing, Settings
            Billing & plan   ▭
            Settings/status  ⚙
Footer      Business switcher
```
Rider (UI-07/08/10) and admin (UI-14) roles get their own nav sets. Public tracking (UI-15) has no shell.

---

## 3. UI-03 Dashboard

| Region | Mobile 360 | Tablet 768 | Laptop 1440 | Wide 1920 |
|---|---|---|---|---|
| Nav | Top bar + bottom tabs with centre **+ New** | Icon rail | Sidebar w-64 | Sidebar |
| Header | Title, date "Lagos time (WAT) · Updated 2:41 PM", refresh icon | + Export CSV, New delivery | + search in top bar, user | Same |
| KPI counters | 2×2 | 4 across | 4 across | 4 across |
| Pipeline | Stacked `<details>` stages (collapsible, attention first) | 2 columns | 2×2 stage grid beside rail | 4 kanban columns |
| Live alerts + performance | Below pipeline | 2-up below pipeline | Sticky right rail 340 px | Rail 380 px |

```
MOBILE 360                    TABLET 768                         LAPTOP 1440
┌──────────────────────┐      ┌──┬──────────────────────────┐    ┌────────┬────────────────────────────────────────┐
│▣ DropDesk      🔍 🔔2│      │▣ │[🔍 Search…]          🔔2 │    │▣DropDsk│[🔍 Search job ID…]          🔔2  Bisi O.│
├──────────────────────┤      │⌂ ├──────────────────────────┤    │OPERATNS├────────────────────────────────────────┤
│Today            [↻]  │      │≡ │Today      [Export][↻][+ New]  │⌂ Today │Today              [Export][↻][+ New]   │
│Tue 13 Oct · WAT      │      │⚠ │┌────┐┌────┐┌────┐┌────┐ │    │≡ Deliv.│┌───────┐┌───────┐┌───────┐┌───────┐   │
│┌─────────┐┌─────────┐│      │👥││⚠ 2 ││◷ 6 ││⇢ 4 ││✓ 11│ │    │⚠ Exc. 2││⚠ 2    ││◷ 6    ││⇢ 4    ││✓ 11   │   │
││⚠ Needs 2││◷ Pend. 6││      │▭ │└────┘└────┘└────┘└────┘ │    │DISPATCH│└───────┘└───────┘└───────┘└───────┘   │
│└─────────┘└─────────┘│      │▥ │┌ Needs attn ┐┌ Pending ┐│    │👥 Ride.│┌ Needs attn ─┐┌ Pending ───┐┌ Live ──┐│
│┌─────────┐┌─────────┐│      │⚙ ││ card       ││ card    ││    │▭ Offers││ DD-24817 ⚠  ││ DD-24822 ◷ ││⚠ 24817 ││
││⇢ Trans 4││✓ Done 11││      │  ││ card       ││ card    ││    │BUSINESS││ Action: …   ││ DD-24825 ◷ ││⚠ 24790 ││
│└─────────┘└─────────┘│      │  │└────────────┘└─────────┘│    │▥ Repts ││ DD-24790 ⚠  ││ View all 6 ││✓ 24802 ││
│⚠ Needs attention  2 ˄│      │  │┌ In transit ┐┌ Deliv'd ┐│    │▭ Bill. │└─────────────┘└────────────┘├ Perf ──┤│
│┌────────────────────┐│      │  ││ card       ││ ✓ row   ││    │⚙ Sett. │┌ In transit ─┐┌ Delivered ─┐│25/27   ││
││DD-24817 [⚠ At risk]││      │  │└────────────┘└─────────┘│    │        ││ DD-24811 ⇢  ││ ✓ Aisha …  ││₦78,500 ││
││Chiamaka Obi ₦3,500 ││      │  │┌ Live alerts┐┌ Perf    ┐│    │        ││ DD-24861 ⇢  ││ ✓ Yemi …   │└────────┘│
││Action: call/reassign│      │  │└────────────┘└─────────┘│    │BK Bisi's│└─────────────┘└────────────┘          │
│└────────────────────┘│      └──┴──────────────────────────┘    └────────┴────────────────────────────────────────┘
│◷ Pending pickup 6   ˄│
│ …cards… View all 6   │      States: loading = skeleton panels (animate-pulse, motion-reduce:animate-none);
│⇢ In transit 4 · ✓ 11 │      cached data renders first. Empty = dashed panel "No deliveries for today yet"
│Live alerts · Perf    │      + New delivery / Import CSV. Error = inline "Couldn't refresh. Showing 2:38 PM
├──────────────────────┤      data." + Try again. Never a blank page.
│ ⌂   ≡   [+]   👥  ⋯  │
└──────────────────────┘
```

---

## 4. UI-05 Create / edit delivery

| Region | Mobile 360 | Tablet 768 | Laptop 1440 |
|---|---|---|---|
| Section nav | Sticky horizontal chip row under top bar (scrolls sideways) | Same, all 5 visible | Sticky vertical step list, left column 200 px |
| Form | 1 column; fields full width | Fieldsets with 2-up pairs (landmark/phone, type/size, price/basis) | Same, centre column |
| Postcode | Input + Look up; result panel stacks its buttons 2-up | Result text and buttons on one line | Same |
| Summary + checklist | Below form | Below form, with actions | Sticky right rail 320 px with actions |
| Actions | Fixed bottom bar: Save draft / Save & assign | In summary | In summary |

```
MOBILE 360                    TABLET 768                         LAPTOP 1440
┌──────────────────────┐      ┌──┬──────────────────────────┐    ┌────────┬──────────┬──────────────────┬──────────┐
│‹ New delivery [DRAFT]│      │  │New delivery       [DRAFT]│    │sidebar │✓ Customer│1 · CUSTOMER      │Summary   │
│✓ Draft saved 2:43 PM │      │  │(✓Cust)(②Drop-off)(③)(④)(⑤)    │        │②Drop-off │ TB Tolu  [Change]│Tolu B.   │
│(✓Cust)(②Drop)(③Pick)→│      │  │┌ 1 · CUSTOMER ──────────┐│    │        │③Pickup   │2 · DROP-OFF      │Surulere  │
│┌ 1 · CUSTOMER ──────┐│      │  │└────────────────────────┘│    │        │④Package  │ Written address* │[⚠ Confirm│
││TB Tolu Bakare [Chg]││      │  │┌ 2 · DROP-OFF ──────────┐│    │        │⑤Charge   │ [LA4S8R2K7WM][Lk]│ postcode]│
│└────────────────────┘│      │  ││Written address*        ││    │        │ (sticky) │ ✓ Found: Adeniran│4–6 PM    │
│┌ 2 · DROP-OFF ──────┐│      │  ││[LA4S8R2K7WM 11/11][Look]│    │        │          │ [Yes][Not right] │₦5,500.00 │
││Written address *   ││      │  ││✓ Found …  [Yes][Not]   ││    │        │          │ Landmark │ Phone │✓ ✓ ⚠ ✓   │
││[textarea]          ││      │  ││Landmark    │ Phone     ││    │        │          │ Access instructs │[Save &   │
││Postcode (optional) ││      │  ││Access instructions     ││    │        │          │3 · PICKUP/TIMING │ assign →]│
││[LA4S8R2K7WM][Look] ││      │  │└────────────────────────┘│    │        │          │ (Now)(3:00)(3:30)│[Save drft│
││✓ Found. Right place?│      │  │ 3 · 4 · 5 (2-up pairs)   │    │        │          │4 · PACKAGE       │🗑 Discard│
││[Yes, confirm][Not] ││      │  │┌ Summary + checklist ───┐│    │        │          │5 · ₦ [5,500.00]  │ (sticky) │
││Landmark / Phone /  ││      │  ││[Save & assign][Draft]  ││    │        │          │  = 550,000 kobo  │          │
││Access + quick chips││      │  │└────────────────────────┘│    └────────┴──────────┴──────────────────┴──────────┘
│└────────────────────┘│      └──┴──────────────────────────┘
│ 3 · 4 · 5 sections   │
│ Summary / checklist  │      Postcode states (all in markup, toggled with [hidden]):
├──────────────────────┤      idle · checking (skeleton) · verified (confirm/not correct) · mismatch (amber,
│[Save draft][Save & →]│      edit/remove) · unavailable (spec copy, "Confirm manually", never blocks save) ·
└──────────────────────┘      invalid (✕ "must be 11 characters. You entered 9.").
```

---

## 5. UI-09 Job details & immutable timeline

| Region | Mobile 360 | Tablet 768 | Laptop 1440 | Wide 1920 |
|---|---|---|---|---|
| Header | ‹ back, mono ID, status badge; actions in fixed bottom bar | Actions inline (Report, Share, ⋯) | Same + breadcrumb | Same |
| Status + 5-step progress | Full width; labels wrap under bars | Same | Left column | Same |
| Exception / POD / charges / drop-off / pickup+rider | Stacked | 2-up panel grid | 2-up grid in left column | Same |
| Event ledger | Full width at end | Full width at end | **Sticky right column 400 px**, scrolls on its own, filter chips | 480 px |

```
MOBILE 360                    TABLET 768                         LAPTOP 1440
┌──────────────────────┐      ┌──┬──────────────────────────┐    ┌────────┬───────────────────────────┬────────────┐
│‹ DD-24857 [✓Deliv'd] │      │  │DD-24857 [✓] [Report][Share][⋯] │sidebar │DD-24857 [✓ Delivered]  [Report][Share][⋯]│
│Delivered at 2:12 PM  │      │  │┌ Delivered at 2:12 PM ──┐│    │        │┌ Delivered at 2:12 PM ───┐┌ History ─┐│
│▬▬ ▬▬ ▬▬ ▬▬ ▬▬        │      │  ││▬▬▬ ▬▬▬ ▬▬▬ ⚠▬▬ ✓▬▬     ││    │        ││▬▬▬▬ ▬▬▬▬ ▬▬▬▬ ⚠▬▬ ✓▬▬  ││🔒 append ││
│✓Acc ✓Pick ⚠2 ✓Deliv  │      │  │└────────────────────────┘│    │        │└─────────────────────────┘│[All][State]│
│┌ ⚠ Exception · ✓Res ┐│      │  │┌ ⚠ Exception · resolved ┐│    │        │┌ ⚠ Exception · resolved ─┐│2:12 ■ ✓Del│
││Reason / attribution││      │  ││reason   │ reported     ││    │        ││reason │ attribution     ││1:48 □ Arr. │
│└────────────────────┘│      │  │└────────────────────────┘│    │        │└─────────────────────────┘│11:30 □ Note│
│┌ Proof of delivery ─┐│      │  │┌ POD ──────┐┌ Charges ──┐│    │        │┌ POD ─────┐┌ Charges ────┐│ TEAM ONLY  │
││🔒 PIN ✓ · 👤 Tolu  ││      │  ││PIN ✓      ││₦5,500.00  ││    │        ││PIN ✓     ││₦7,000.00   ││11:16 ■ ⚠ F │
││[📷 Load 84 KB]     ││      │  │└───────────┘└───────────┘│    │        │├ Drop-off ┤├ Pickup/Rider┤│ …          │
│└────────────────────┘│      │  │┌ Drop-off ─┐┌ Rider ────┐│    │        ││0803•••4471│ Musa I. ✓   ││ (sticky,   │
│ Charges · Drop-off   │      │  │└───────────┘└───────────┘│    │        │└──────────┘└─────────────┘│  scrolls)  │
│ (masked) · Rider     │      │  │┌ Event history (full) ──┐│    └────────┴───────────────────────────┴────────────┘
│┌ Event history ─────┐│      │  │└────────────────────────┘│
││2:12 ■ ✓ Delivered  ││      └──┴──────────────────────────┘    Ledger row: [time mono] [■ state dot] title (icon+word),
││ STATE A → STATE B  ││                                         actor · role · source, detail, evidence refs,
││11:16 ■ ⚠ Failed    ││                                         STATE_A → STATE_B chip. Corrections are new events.
│└────────────────────┘│                                         "Team only" notes are removed server-side for riders.
├──────────────────────┤
│[Report][Share][⋯]    │
└──────────────────────┘
```

Sample data uses Lagos locations (Lekki Phase 1, Ikoyi, Ikeja/Computer Village, Yaba/Herbert Macaulay, Surulere/Adeniran Ogunsanya, Sangotedo). Postcodes like `LA4S8R2K7WM` are placeholders; confirm the real 11-character format from current NIPOST documentation.
