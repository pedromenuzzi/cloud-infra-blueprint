# Changesets

This directory tracks changesets for the public packages in the monorepo:

- `@blueprint/ir`
- `@blueprint/hcl`
- `@blueprint/resources`
- `@blueprint/templates`
- `@blueprint/ui`

The applications (`@blueprint/web`, `@blueprint/api`, `@blueprint/storybook`)
are not published to npm and are listed under `ignore` in `config.json`.

## Workflow

For every PR that **changes the behavior or public API of one of the packages
above**, add a changeset:

```bash
pnpm changeset
```

The CLI asks which packages changed and at which severity (`major`, `minor`,
`patch`), then writes a small `*.md` file under this directory. Commit it
together with your code change.

When PRs land on `main`, the [`release.yml`](../.github/workflows/release.yml)
workflow opens (or updates) a single "Version packages" PR that consumes
every pending changeset, bumps versions and rewrites changelogs. Merging
that PR triggers `npm publish` for the bumped packages.

## What needs a changeset?

| Change                                 | Changeset?                |
| -------------------------------------- | ------------------------- |
| New public function / type / component | yes (`minor`)             |
| Breaking change to public API          | yes (`major`)             |
| Bug fix in a public package            | yes (`patch`)             |
| Internal refactor with no API impact   | no                        |
| Docs only                              | no                        |
| Test only                              | no                        |
| Change in `apps/*` only                | no (apps are unpublished) |

A `changeset/check` action in CI fails the PR if it touches a public
package without a changeset.

See [docs/RELEASING.md](../docs/RELEASING.md) for the full release recipe
and how the publish step picks up `NPM_TOKEN`.
