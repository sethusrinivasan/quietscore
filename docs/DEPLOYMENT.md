# Deployment

Production: [quietscore.cancun.workers.dev](https://quietscore.cancun.workers.dev/). One `quietscore` Worker serves Static Assets plus `/mcp` and `/healthz`. The calculator never calls `/mcp`.

## Automatic mainline deployment

`.github/workflows/cloudflare.yml` validates pull requests and every push to `main`. It builds optimized WASM/assets, checks formatting/types, runs units/FIRST parity/Playwright, validates the Worker package, then deploys and verifies the public endpoints. Only `main` push/manual runs deploy. Pending deployments queue (GitHub limit: 100); pull requests receive no deployment secret. Reports publish even when checks fail.

GitHub repository configuration:

- Secret `CLOUDFLARE_API_TOKEN`: Workers Editor access to the existing `quietscore` Worker.
- Variable `CLOUDFLARE_ACCOUNT_ID`: `2fd5ebb7d5aa0d8348cfaad3e3b3b07f`.

If deployment reports “No access to the specified service/resource,” check the token’s Worker scope, Editor role, and target account. An active token alone does not prove authorization. Do not copy an interactive OAuth credential into CI. Adding a secret does not rerun a failed job automatically; rerun the workflow after a credential fix.

```sh
pnpm build
pnpm deploy:check
pnpm run deploy
```

Do not also enable Workers Builds: use one deployment path. Configure branch-required checks if desired. Revert a bad change on `main`, or use Cloudflare rollback and reconcile Git before the next deployment. Retain lockfiles and pinned action/toolchain revisions; review upgrades.

## Free-first footprint

No KV, D1, R2, Durable Objects, queues, cron jobs, paid domains, analytics, or build service is required. Static asset requests are free/unlimited under Cloudflare’s documented billing; Worker/MCP requests consume plan allowances. Use Workers Free and avoid plan upgrades. Exceeding Free limits can interrupt Worker endpoints. GitHub’s public-repository standard Actions runners are free; artifacts expire after seven days. Existing account subscriptions are not changed by this project.

## MCP credentials

Hosted MCP is `https://quietscore.cancun.workers.dev/mcp`. Set `MCP_AUTH_TOKEN` as a Cloudflare secret; clients send `Authorization: Bearer <token>`. Keep `ALLOW_PUBLIC_MCP` false. This bearer credential is separate from deployment credentials and survives normal deployments.

```sh
pnpm exec wrangler secret put MCP_AUTH_TOKEN
```

The initial credential is stored on the setup machine in an owner-only file under `~/.config/quietscore/mcp-token`. Configure authorized AI clients through their secure credential settings; do not publish its value. Local stdio (`pnpm mcp:stdio`) avoids Cloudflare vector processing.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [roles](https://developers.cloudflare.com/workers/authorization/workers/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/), and [GitHub queue behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
