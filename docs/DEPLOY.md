# Deployment

## Target

Cloudflare, custom domain `sports.allenzheng.com`. HTTPS is required for camera access (localhost counts as secure for development).

## Deployment configuration to prepare

Prepare the deployment configuration: a `wrangler` config and a `_headers` file with immutable caching for versioned assets and the CSP. The exact steps are documented in this file.

**Do not try to log in to or change Allen's Cloudflare or DNS accounts.** Allen runs those steps himself.

## Open item: DNS hosting

- Where `allenzheng.com`'s DNS is hosted: unknown. Write `docs/DEPLOY.md` to cover both the case where it is already on Cloudflare and the case where it isn't. Deploy nothing.

Status: stub. Full step-by-step instructions are written in milestone 8.
