# Internal Memo — PROJECT-X

Team,

PROJECT-X enters its final phase next week. Everything we shipped on linux
so far has been stable, and PROJECT-X builds on that foundation.

## Rollout plan

1. Freeze PROJECT-X feature branches on Friday.
2. Rebuild the linux images and push them to the registry.
3. Run the PROJECT-X smoke tests on every linux node.
4. If all green, tag PROJECT-X v1.0.0 and announce.

## Notes

- The Linux kernel team upstream reviewed our patches. Huge thanks!
- Support asked that PROJECT-X docs mention linux compatibility explicitly.
- Remember: PROJECT-X is confidential until the announcement.
- One more linux tip: read the release notes before upgrading.
- Linux is a registered trademark of Linus Torvalds.
