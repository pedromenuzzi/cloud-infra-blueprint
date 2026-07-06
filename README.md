<p align="center">
  <img src="public/favicon.svg" width="64" alt="Cloud Blueprint logo" />
</p>

<h1 align="center">Cloud Blueprint</h1>

<p align="center">
  <b>Design cloud infrastructure visually. Ship Terraform instantly.</b><br/>
  A free, open-source blueprint editor that keeps your architecture diagram and your
  Terraform code in perfect sync — AWS, Azure and GCP, running entirely in your browser.
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
pnpm test       # round-trip + template + share-link suites
pnpm typecheck
pnpm build      # static production build in dist/
```

That's it — there is no database, no API keys, no backend to configure.

## Deploy for free

The app is a fully static SPA. Any free static host works:

| Host | How |
| ---- | --- |
| **Vercel** | Import the repo → framework "Vite" → deploy. (`vercel.json` already handles SPA rewrites.) |
| **Netlify** | Import the repo → build `pnpm build`, publish `dist`. (`public/_redirects` included.) |
| **Cloudflare Pages** | Import → build `pnpm build`, output `dist`. |
| **GitHub Pages** | Enable *Settings → Pages → Source: GitHub Actions*. The included [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds with the right base path on every push to `main`. |

## Tech

| Layer | Choice |
| ----- | ------ |
| App | React 18 + TypeScript + Vite + Tailwind CSS 4 |
| Canvas | [React Flow](https://reactflow.dev) (`@xyflow/react`) with custom nodes, subflows and resize |
| Code editor | Monaco with a custom HCL language, catalog-aware autocomplete and diagnostics |
| HCL ↔ IR | Hand-rolled error-tolerant parser + deterministic emitter + minimal-patch engine (`src/hcl`) |
| State | Zustand (single editor store owns files + IR + history) |
| Export / share | fflate (zip download, deflated share-links in the URL fragment) |

### Repo map

```
src/
├── ir/          # canonical IR types, ops, graph derivation, layout, validation
├── hcl/         # parser, emitter, minimal-patch engine (+ round-trip tests)
├── resources/   # declarative multi-cloud catalog (38 resources: AWS / Azure / GCP)
├── templates/   # Web App AWS, Static Site CDN, ECS Fargate, Azure Web App, GCP Static Site
├── features/    # editor (canvas, code, palette, inspector, topbar), templates modal
├── routes/      # landing, dashboard, editor, 404
├── components/  # design-system UI kit, thumbnails, theme toggle, toasts
└── lib/         # localStorage projects, zip export, share links, utils
```

## Extending

- **Add a resource**: one `defineResource({...})` entry in `src/resources/{aws,azure,gcp}.ts`
  — schema fields drive the inspector form, autocomplete, validation and node rendering.
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
- [ ] **F6** — PWA offline install, onboarding tour, community template gallery

The client-only architecture is deliberate: parsing/emitting runs in the browser, so a
future backend only needs to store snapshots and relay WebSockets — exactly as specified
in the original master spec.

## License

[MIT](LICENSE) — free forever, for everyone.
