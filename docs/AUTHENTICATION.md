# MCP authentication

The calculator is anonymous. Hosted AI tools connect to `https://quietscore.cancun.workers.dev/mcp` using OAuth 2.1/PKCE. [Manage connections](https://quietscore.cancun.workers.dev/connect) lists grants and creates individual script tokens. Local stdio requires no Cloudflare account or sign-in.

## User experience

1. Add the MCP URL in an OAuth-capable AI client.
2. Review the client name, verified domain when available, callback host, and permission on QuietScore’s consent page. Dynamically registered names are explicitly unverified.
3. Allow access, then sign in with GitHub. No repository or email scope is requested.
4. Return to the client. `cvss:read` permits scoring, definitions, and explanations; it grants no access to local drafts or files.
5. Revoke the client from `/connect`, or use the standard OAuth revocation endpoint advertised in discovery metadata.

For scripts, sign in at `/connect`, create a named token, copy it once, and send `Authorization: Bearer TOKEN`. Tokens expire after 30 days and can be revoked individually. Their values are never stored; KV holds SHA-256 hashes and owner/expiry records.

## Architecture and security

One Worker handles the calculator, MCP resource, and authorization server. One KV namespace stores authorization state, grants, identity sessions, and script-token hashes. It never stores vectors or assessment notes. Cloudflare’s pinned `@cloudflare/workers-oauth-provider` implements MCP discovery, exact redirect validation, S256 PKCE, resource-bound access tokens, rotating refresh tokens, consent binding, and revocation.

Access tokens live for 15 minutes; refresh grants for 30 days. Browser management sessions expire after eight hours. Secure/HttpOnly/SameSite cookies bind authentication to the browser. Management mutations check the session CSRF token and exact Origin. Auth HTML uses same-origin referrers so browser form posts retain the Origin header; external destinations receive no referrer. Callback redirects use no-referrer. Consent form policy allows GitHub and the validated callback origin only. Consent appears before upstream sign-in and displays the callback host to prevent confused-deputy approvals. Client-controlled text is HTML-escaped. The GitHub access token is used only to fetch the public identity and is not persisted or forwarded.

CIMD is supported with `global_fetch_strictly_public`; dynamic client registration remains enabled for older MCP clients. The existing `MCP_AUTH_TOKEN` secret remains a migration-only credential. Remove it with `wrangler secret delete MCP_AUTH_TOKEN` once existing clients use OAuth or individual tokens. Cloudflare deployment credentials are never MCP credentials.

KV is eventually consistent. Newly created credentials and revocation may take time to propagate globally; this is not an immediate globally atomic revocation guarantee. Free-plan quotas can limit availability. No assessment logging or tracing is enabled.

```mermaid
sequenceDiagram
  participant User
  participant AI as AI client
  participant QS as QuietScore Worker
  participant GH as GitHub
  participant KV as Auth KV
  AI->>QS: MCP request without token
  QS-->>AI: 401 and OAuth discovery
  AI->>QS: Authorization request with S256 PKCE
  QS-->>User: Client, callback host, permission, Allow/Deny
  User->>QS: Allow (browser-bound consent)
  QS->>GH: Sign-in with state and upstream PKCE
  GH-->>QS: Authorization code
  QS->>GH: Exchange code and fetch public identity
  QS->>KV: Grant and expiring identity session
  QS-->>AI: Authorization code via exact callback
  AI->>QS: Code plus PKCE verifier
  QS-->>AI: Resource-bound access/refresh tokens
  AI->>QS: Authorized CVSS request
  QS-->>AI: WASM result; no assessment persistence
```

## Operator setup

Create a GitHub OAuth app with homepage `https://quietscore.cancun.workers.dev/`, and these **exact** redirect URIs (no wildcard matching):

- `https://quietscore.cancun.workers.dev/auth/callback`
- `https://quietscore.cancun.workers.dev/auth/account-callback`

Leave device flow disabled. Store `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as encrypted Worker secrets. Keep the secret out of Git, CI logs, and chat. Secrets survive normal Wrangler deployments.

```sh
pnpm exec wrangler secret put GITHUB_CLIENT_ID
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm run deploy
```

`wrangler.jsonc` binds `OAUTH_KV` and pins `PUBLIC_URL`; regenerate bindings after configuration changes. For local OAuth testing, use a separate GitHub OAuth app and local `.dev.vars` with `PUBLIC_URL=http://localhost:8787`, plus its client ID/secret and two local callbacks. Secure localhost cookie support depends on the browser; production always uses HTTPS. Never share production grants with a preview environment.

The KV namespace must already exist for CI deployments. CI needs access to deploy its binding (add Workers KV Storage read permission if required), in addition to Worker editing. OAuth app setup is a one-time operator action; deploys do not create apps or change secrets.

References: [Cloudflare provider](https://github.com/cloudflare/workers-oauth-provider), [consent/upstream security](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md), [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
