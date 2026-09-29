<p align="center">
  <img src="public/favicon.svg" width="64" alt="Cloud Blueprint logo" />
</p>

<h1 align="center">Cloud Blueprint</h1>

<p align="center">
  <b>Design cloud infrastructure visually. Ship Terraform instantly.</b><br/>
  A free, open-source blueprint editor that keeps your architecture diagram and your
  Terraform code in perfect sync — AWS, Azure and GCP, running entirely in your browser.
</p>

<p align="center">
  <a href="https://pedromenuzzi.github.io/cloud-infra-blueprint/"><b>Open the live app →</b></a>
</p>

---

## What it does

Cloud Blueprint is a **split-screen editor**: a Cloudcraft-style blueprint canvas on the
left, a Monaco editor with real `.tf` files on the right, and **true bidirectional sync**
between them.

- 🖱️ **Drag a resource** from the palette → the HCL block writes itself.
- ⌨️ **Type (or paste) Terraform** → the diagram rebuilds instantly.
- 🧩 **Nesting is real**: dropping an EC2 into a subnet sets `subnet_id`; the VPC boxes on
  the canvas are derived from actual references in your code.
- 🔗 **Edges are real**: drawing a connection sets the right attribute
  (`vpc_security_group_ids`, `target`, …); deleting it removes the reference.
- 💾 **No account, no server**: projects auto-save to your browser. Share a whole project
  as a URL. Export a ready-to-`terraform apply` zip.
- 🛡️ **Security audit**: findings ranked by severity with plain-language explanations and
  one-click fixes, a canvas lens that highlights what's exposed to the internet, and a
  firewall rule editor for AWS security groups / NACLs, Azure NSGs and GCP firewalls.
- 🧮 **Validation & CIDR planner**: warnings for overlapping or out-of-range CIDRs, invalid
  cloud names and AZs outside the region, plus an inspector planner that carves new subnets
  (or splits a VPC across AZs) from the free address space.
- 💵 **Cost estimate**: a live "~$27/mo" on the canvas, a per-resource breakdown in the inspector
  and the PDF — on-demand list prices shipped with the app (no network calls), every assumption shown.
- 📄 **PDF export**: a shareable architecture document — the diagram plus a readable summary
  of resources, connections, security findings and the code — generated in the browser.
- 🎓 **Built-in tutorials**: step-by-step lessons that grow a real project, showing the
  diagram and the code side by side with the new lines highlighted — any step opens in
  the editor.

### Built for speed

- ⌘ **Command palette** (`⌘K` / `Ctrl+K`): add any of the 92 services, jump to a resource or
  file, tidy the layout, export, switch theme, start from a template.
- ✨ **Quick add**: double-click the canvas to drop a service exactly there (nested into the
  VPC / subnet / group under the cursor).
- 🪄 **Tidy up**: one-click layered auto-layout (ELK) that understands containers — one undo step.
- 🧲 **Multi-select** (Shift-drag or `Ctrl`-click): align and distribute, set a shared setting,
  tag, connect (e.g. one security group to five instances) or delete them all — one undo step each.
- 🔁 **Selection sync**: pick a node and the code scrolls to its block; click inside a block and
  the node is selected.
- 🖱️ **Right-click actions**: show in code, rename (`F2`), duplicate (`⌘D`), copy address,
  Terraform docs, delete.
- 📥 **Import** existing Terraform: drop `.tf` files, a folder or a `.zip` on the dashboard.
  The root module is imported; `modules/` directories are skipped for now (modules aren't
  supported yet), and so are `.terraform/`, state files and the lock file.
- 🖼️ **Export** the diagram as PNG or SVG, alongside the Terraform zip.
- 🎨 **A real icon system**: every service has its own glyph on a category-colored tile;
  floating edges attach to the nearest side and animate the data flow of the selection.
- ⌨️ Collapsible panels (`⌘B` palette, `⌘J` code, `⌘I` inspector) and a `?` shortcuts sheet.

### Why it's different

Most tools are one-directional (diagram → code) or closed source. Cloud Blueprint keeps a
single **canonical IR** (typed intermediate representation) between the two views:

```
canvas op ──▶ IR ops ──▶ minimal text patch ──▶ re-parse ──▶ fresh IR ──▶ canvas + editor
keystrokes ──▶ debounced parse ──▶ new IR (positions carried over) ──▶ canvas
```

- **Your formatting survives.** Canvas edits patch only the touched block — comments,
  blank lines, heredocs, functions and conditionals round-trip byte-for-byte.
- **Layout lives in the code** as a managed comment (`# @blueprint:pos=x,y`), so the
  file itself is the complete source of truth — git-diff friendly.
- **Anything the parser can't model** (complex expressions, `dynamic` blocks, `locals`,
  `data` sources) is preserved verbatim and shown as-is.

## Quick start

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

```bash
pnpm test       # parser, round-trip fuzz, patcher, catalog, templates, security, storage, PDF
pnpm typecheck
pnpm lint       # ESLint (rules of hooks, no stray console/debugger)
pnpm build      # static production build in dist/
pnpm test:e2e   # Playwright against the production build (run `pnpm build` first)
```

The generated Terraform is checked with the real CLI too (CI runs this on every push):

```bash
pnpm templates:emit .tf-templates   # every starter template as .tf files
pnpm catalog:emit .tf-catalog       # one project per provider with every palette resource
bash scripts/terraform-validate.sh .tf-templates    # init + validate + fmt -check, per project
bash scripts/terraform-validate.sh .tf-catalog
```

First E2E run on a new machine: `pnpm exec playwright install --with-deps chromium`.

That's it — there is no database, no API keys, no backend to configure.

## Deploy for free

The app is a fully static SPA. Any free static host works:

| Host | How |
| ---- | --- |
| **Vercel** | Import the repo → framework "Vite" → deploy. (`vercel.json` already handles SPA rewrites.) |
| **Netlify** | Import the repo → build `pnpm build`, publish `dist`. (`public/_redirects` included.) |
| **Cloudflare Pages** | Import → build `pnpm build`, output `dist`. |
| **GitHub Pages** | Enable *Settings → Pages → Source: GitHub Actions*. The included [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds with the right base path and deploys once the CI workflow (typecheck, tests, build, E2E) passes on `main`. |

> **Deep links on GitHub Pages return HTTP 404.** Pages has no rewrite rules, so the
> workflow copies `index.html` to `404.html`: a deep link such as `/editor/…` or
> `/tutorials/…` renders correctly and survives a refresh, but the response status is 404
> (crawlers and link checkers will report it). This can't be fixed on Pages. Vercel and
> Netlify serve those routes with **200** thanks to the included `vercel.json` and
> `public/_redirects`.

## Tech

| Layer | Choice |
| ----- | ------ |
| App | React 18 + TypeScript + Vite + Tailwind CSS 4 |
| Canvas | [React Flow](https://reactflow.dev) (`@xyflow/react`) with custom nodes, subflows and resize |
| Code editor | Monaco with a custom HCL language, catalog-aware autocomplete and diagnostics |
| HCL ↔ IR | Hand-rolled error-tolerant parser + deterministic emitter + minimal-patch engine (`src/hcl`) |
| State | Zustand (single editor store owns files + IR + history) |
| Export / share | fflate (zip download + import, deflated share-links in the URL fragment), html-to-image (PNG/SVG) |
| Command palette | [cmdk](https://cmdk.paco.me), loaded on first use |
| Auto-layout | [ELK](https://eclipse.dev/elk/) (`elkjs`), loaded on first use |
| Icons | [Lucide](https://lucide.dev) glyphs on category-colored tiles (`src/resources/icons.tsx`) |

### Repo map

```
src/
├── ir/          # canonical IR types, ops, graph derivation, layout, validation
├── hcl/         # parser, emitter, minimal-patch engine (+ round-trip tests)
├── resources/   # declarative multi-cloud catalog (92 resources: 43 AWS / 24 Azure / 25 GCP)
├── templates/   # 11 patterns: AWS web/static/ECS/serverless/secure 3-tier, Azure web/static, GCP web/run/static, multi-cloud DR
├── tutorials/   # step-by-step lessons (diagram + code, diff-highlighted)
├── security/    # security model, topology analysis, audit findings + fixes, rule editing
├── features/    # editor (canvas, code, palette, inspector, topbar), security panel, PDF export, templates modal
├── routes/      # landing, dashboard, editor, tutorials, 404
├── components/  # design-system UI kit, thumbnails, theme toggle, toasts, app shell (errors, share links, storage notices)
└── lib/         # localStorage projects, Terraform import, zip export, share links, PDF writer, utils
e2e/             # Playwright specs (editor, navigation, share links, import, persistence, PDF, regressions)
```

## Extending

- **Add a resource**: one `defineResource({...})` entry in `src/resources/{aws,azure,gcp}.ts`
  — schema fields drive the inspector form, autocomplete, validation and node rendering.
  `src/resources/catalog.test.ts` checks every entry automatically (refs point at real types,
  a palette drop round-trips through the parser).
- **Add a template**: build an IR in `src/templates/index.ts` and register it.
- **Add semantics**: containment and connection rules are data on the resource definition,
  not special cases in the canvas.

## Roadmap

- [x] **F1** — IR + HCL round-trip engine (byte-preserving patches)
- [x] **F1.5** — Design system, landing, dashboard, templates
- [x] **F2** — Canvas + palette + inspector
- [x] **F3 (solo)** — Bidirectional sync, undo/redo, diagnostics
- [ ] **F4** — Optional sync backend (NestJS + Postgres + Yjs) for teams & realtime collab
- [ ] **F5** — GitHub/GitLab push, org template libraries
- [x] **F3.5** — Premium UX: command palette, quick add, tidy layout, selection sync,
  import/export, per-service icons, first-run tips
- [ ] **F6** — PWA offline install, guided onboarding tour, community template gallery

The client-only architecture is deliberate: parsing/emitting runs in the browser, so a
future backend only needs to store snapshots and relay WebSockets — exactly as specified
in the original master spec.

## License

[MIT](LICENSE) — free forever, for everyone.
