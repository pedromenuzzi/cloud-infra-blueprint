---
'@blueprint/resources': minor
'@blueprint/templates': minor
---

Add a public plugin API for community-authored providers and templates.

`@blueprint/resources` now exports `registerProvider`, `unregisterProvider`,
`setProviderResources`, `getRegisteredProviders`, `getRegisteredCatalog` and
the live helper `getAllResources()`. The legacy `allResources`,
`resourcesByType` and `resourcesByProvider` exports keep their previous
shape (frozen to the core catalog) so existing callers are unaffected.

`@blueprint/templates` now exports `registerTemplate`,
`unregisterTemplate`, `getRegisteredTemplates`, `findRegisteredTemplate`
and the live helper `getAllTemplates()`. `allTemplates` and
`templatesBySlug` remain frozen to the core catalog for compatibility.

See [`docs/CREATING-A-PROVIDER.md`](https://github.com/cloud-blueprint/cloud-blueprint/blob/main/docs/CREATING-A-PROVIDER.md)
for the full contract and conventions
(`@blueprint-provider/<name>`, `@blueprint-template/<slug>`).
