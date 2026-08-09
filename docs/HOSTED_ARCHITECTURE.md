# Hosted mcp-deploy — Architecture Design

Status: **decided 2026-08-07** — build Model B on a free/$5 Cloudflare account,
get it working, and defer the scaling choice. See §10.
Question: should mcp-deploy become a hosted web app where users get MCPs
without a Cloudflare account, and if so, where is the boundary between
"I host it" and "you deploy your own"?

---

## 1. The pain we're actually solving

The stated problem is onboarding and updates:

- Lab mates have to `git clone`, `npm install`, `npm link`, install Node 20+.
- Every time the dashboard changes, they have to `git pull` and re-link.
- They also need their own Cloudflare account and to complete a `wrangler login`.

Note that only the *first two* are about the dashboard. The third is about
where the worker runs. **These are separate problems and they have separate
answers.** Conflating them is what makes the design question feel hard.

| Layer | What it is | Who should run it |
|---|---|---|
| **Control plane** | The Next.js dashboard, catalog, secret entry, deploy orchestration | **Always hosted by us.** No exceptions. |
| **Data plane** | The Cloudflare Worker that actually serves `/mcp` and holds API keys | Configurable — see §3 |

Hosting the control plane alone eliminates ~90% of the reported pain. Nobody
installs anything, and updates to the dashboard are a `git push`. That decision
is easy and should not wait on the harder data-plane question.

## 2. What the codebase already supports

This matters, because the hosted design is much closer than it looks.

> **Status update (2026-08-07): this section is now history — phase 1 is done.**
> See §11 for what actually shipped. The two paragraphs below describe the
> codebase as it was when this was written, and are kept because the reasoning
> still explains *why* phase 1 looked the way it did.

**The REST deploy path already exists and is not tied to a local machine.**
`src/lib/cloudflare-deploy.ts` (`CloudflareDeployService`) does worker upload,
bulk secrets, health checks, and deletion entirely over the Cloudflare REST API.
It is constructed as `new CloudflareDeployService(apiToken, accountId)` — it has
no opinion about *whose* account that is. `src/app/api/mcps/[slug]/deploy`,
`.../secrets`, and `.../status` already use it, reading credentials from the
`config` table via `store.getCfToken()` / `store.getCfAccountId()`.

**The wrangler shell-out path is the thing that blocks hosting.**
`src/lib/wrangler.ts` runs `npx wrangler` via `child_process`, and
`src/lib/operations.ts` (used by the CLI) imports its `deployWorker`,
`setSecrets`, `deleteWorker`, `ensureKVNamespace`. `src/lib/cloudflare-config.ts`
returns the literal placeholder `"wrangler-managed"` instead of a token. So we
currently have two parallel deploy implementations, and the CLI-facing one
cannot run in a serverless environment.

*Implication:* consolidating on `CloudflareDeployService` is a prerequisite and
also just good hygiene — it removes a duplicated code path.

**Auth wrappers are already spec-correct.** `worker-oauth-wrapper.ts` serves
`/.well-known/oauth-authorization-server` (RFC 8414),
`/.well-known/oauth-protected-resource` (RFC 9728), dynamic client registration,
and returns `WWW-Authenticate: Bearer resource_metadata=...` on 401. That is
exactly what a modern remote MCP server is required to expose. The OAuth flow
runs *inside each deployed worker*, so it does not require an always-on
mcp-deploy server.

**Live credential validation already exists.** `TestSpec` in the MCP metadata
plus `src/lib/test-runner.ts` can verify a user's API key against the real API
at entry time. This is a significant UX asset for self-serve onboarding — it
turns "paste a key and hope" into "paste a key, see a green check".

**Storage is the other blocker.** `src/lib/db.ts` uses `better-sqlite3` against
a local file (`data/mcp-deploy.db`), and every table is keyed by `slug` alone —
`deployments(slug)`, `secrets(slug, key)`. There is no concept of a user
anywhere in the schema. Native SQLite also cannot run on Workers.

## 3. The three data-plane models

### Model A — one shared multi-tenant worker per MCP

One `zotero-assistant` worker serves everyone; the caller's identity comes from
OAuth, and per-user credentials live in KV/D1 keyed by that identity.

- Cheapest: one script per MCP regardless of user count. Instant onboarding.
- One bad deploy breaks every user at once, and a single compromise exposes
  everyone's keys.

> **Correction (2026-08-07).** An earlier draft of this section claimed pooling
> "requires rewriting every MCP server." That overstates the code cost. Reading
> `workers/zotero-assistant-mcp.mjs` directly: credentials are read inside
> `init()` (line 72972), which runs **per Durable Object instance**, not at
> module scope. DO instances are already addressed by name via `idFromName`
> (62855), and the `McpAgent` base class already accepts per-instance props
> injected by the auth layer through the `x-partykit-props` header (62894) —
> which is Cloudflare's designed channel for handing an authenticated user's
> claims to their agent. So per-server the change is roughly
> `this.env.ZOTERO_API_KEY` → `this.props.zoteroApiKey` plus naming the DO after
> the user id. Two lines, not a rewrite.

The real objection to pooling is therefore not code volume, it is:

- **Contract, not rewrite.** `env.X` is the ordinary Workers convention, so any
  MCP we did not write ourselves reads credentials that way. Pooling means every
  MCP in the catalog must adopt our props convention and stay in sync with it —
  a permanent coordination tax on "add any compatible MCP via a + button."
- **Custody becomes absolute.** A pooled worker must be able to decrypt *any*
  user's credentials at runtime, so they live in D1/KV under envelope encryption
  with the unwrapping key bound to the script. We lose the property that
  Cloudflare's script boundary does isolation for free, and a code compromise
  becomes total rather than per-user.

**Rejected for now** — on contract and custody grounds, not effort.

### Model B — one worker per user, in *our* Cloudflare account ✅ recommended

Alice gets `zotero-assistant-alice.<our-subdomain>.workers.dev`, with her Zotero
key set as a normal Cloudflare secret on *her* worker.

- **Zero changes to the MCP servers.** `env.ZOTERO_API_KEY` keeps working
  exactly as it does today. The release format is unchanged.
- Real isolation: separate script, separate Durable Object, separate secrets.
- **Central updates — the killer feature for the stated pain.** When a new
  release ships, we redeploy every user's worker from the dashboard. Lab mates
  never do anything. This is strictly better than the current model, where
  each person has to notice and click.
- Users never see Cloudflare at all.

Costs and limits:
- Cloudflare allows **100 Worker scripts on the free plan, 500 on paid ($5/mo)**.
  At ~3 MCPs per person that is ~33 users free / ~165 paid. Fine for a lab,
  not fine for a public launch — worth knowing the ceiling exists.
- These workers use SQLite-backed Durable Objects (`new_sqlite_classes`), which
  are available on the free plan.
- We pay for their usage, and we become custodian of their API keys (see §6).

### Model C — bring your own Cloudflare account (today's model)

Keep it. It is the escape hatch for people outside the lab, for anyone who
doesn't want us holding their credentials, and for anyone who outgrows our
account limits.

### Model D — Workers for Platforms (the scaling path, not needed yet)

Added 2026-08-07. This is the answer to "Model B has a script ceiling" that does
**not** require pooling. Workers for Platforms is Cloudflare's product for
running many isolated per-customer workers. Scripts go into a **dispatch
namespace** instead of the account's normal script list, which does not count
against the 100/500 limit and is built to hold thousands. A small **dispatch
worker** on our own domain routes each request to the right user script via
`env.DISPATCHER.get(scriptName).fetch(request)`.

Why it fits: user workers still take ordinary secret bindings, so
`env.ZOTERO_API_KEY` keeps working and the release contract is untouched. It
keeps every property Model B buys — zero MCP changes, per-user isolation,
per-worker secrets — and only removes the ceiling.

- **Small diff.** Every call in `src/lib/cloudflare-deploy.ts` hits
  `/accounts/{id}/workers/scripts/{name}` (lines 138, 179, 202). The platform
  equivalent is `/accounts/{id}/workers/dispatch/namespaces/{ns}/scripts/{name}`
  — same multipart upload, same bulk-secrets endpoint. About five call sites.
  The `subdomain` calls (269, 287) disappear, replaced by dispatch routing.
- **We own the URLs.** Endpoints become `mcp.ourlab.org/u/alice/zotero/mcp`
  rather than a `workers.dev` subdomain baked into whatever the user pasted into
  Claude, so scripts can be renamed or migrated without anyone re-pasting. This
  also delivers the "use your own domain for MCPs" item in TODO.md.
- **Auth placement is a choice.** Keeping OAuth/bearer inside each user worker
  is zero change and the right default. Hoisting it into the dispatch worker
  later buys central revocation and rejects unauthenticated requests before
  paying for a dispatch.

⚠️ **Verify before committing to this path:** whether SQLite-backed Durable
Objects work in dispatch-namespace user workers. We declare `new_sqlite_classes`
migrations (`src/lib/cloudflare-deploy.ts:113`) because `McpAgent` *is* a
Durable Object — the MCP session lives in it. DO support in Workers for
Platforms has carried caveats historically; this is go/no-go and is not
confirmed here. Cheap test: create a namespace, upload an existing bundle
unmodified as a user worker, confirm the migration is accepted and a session
survives.

Cost: a paid add-on with a monthly floor (believed ~$25/mo plus per-script
pricing — **verify current pricing**, this is from memory). So it bills from
user one, where Model B on a normal account is free to ~33 users.

### The boundary, stated plainly

> **We host the control plane for everyone. The data plane defaults to our
> Cloudflare account ("managed"), with BYO-Cloudflare available as a per-user
> setting.**

The reason this boundary is the right one: **Models B and C are the same code
path.** Both are `new CloudflareDeployService(apiToken, accountId)`. The only
new concept is a per-user deployment target:

```ts
type DeploymentTarget =
  | { mode: "managed" }                              // use the app's own CF creds
  | { mode: "byo"; apiToken: string; accountId: string }; // user's own
```

That is a genuinely small abstraction for how much optionality it buys. We do
not fork the project or maintain two products — the hosted app and the
self-hosted CLI stay one codebase with a parameter.

Model D extends the same union rather than replacing it, which is why the
scaling decision can be deferred safely — it is a third case, not a redesign:

```ts
  | { mode: "platform"; namespace: string };         // Workers for Platforms
```

## 4. Sign-in

**Do not use "Sign in with Cloudflare."** Cloudflare does not offer a general
consumer identity provider. Its OAuth is a device-authorization flow intended
for the `wrangler` CLI, and the token it issues grants broad account access.
Using it as a login button would mean asking every lab mate to hand the app
real Cloudflare credentials — the exact friction we are removing, plus a
liability.

Recommended, in order of preference for a lab:

1. **Google sign-in restricted to the university domain.** Zero new accounts,
   and the domain allowlist *is* the access control.
2. **GitHub OAuth** — good if the group skews technical and the MCP catalog is
   GitHub-centric anyway.
3. **Email magic link + invite code** — simplest to build, no IdP config.

Keep two auth layers mentally separate; both are required:

- **Dashboard auth** (new) — who can log in and manage deployments.
- **MCP endpoint auth** (already built) — bearer / OAuth / open on the deployed
  worker, which is what Claude presents when it connects.

In managed mode, default new deployments to **bearer** (one copy-paste URL, no
password to communicate) and offer OAuth for anyone who wants it.

## 5. Data model changes

The catalog stays global — we curate which MCPs are offered. Only deployment
and secret state becomes per-user:

```
mcps         (slug, github_repo, release_tag, ...)          -- global, curated
users        (id, email, name, created_at)                   -- NEW
deployments  (user_id, slug, status, worker_url, ...)        -- PK becomes (user_id, slug)
secrets      (user_id, slug, key, value)                     -- PK becomes (user_id, slug, key)
```

`worker_url_mapping`, `jwt_secrets`, and the OAuth tables key off the deployed
worker rather than the slug, so they need the same treatment.

Worker names **must** be namespaced in managed mode — `workerName` currently
comes straight from `metadata.worker.name`, so two users would collide on
`zotero-assistant`. Derive it as `${metadata.worker.name}-${user.handle}` at
resolve time in `mcp-registry.ts`. Durable Object migration tags are per-script,
so they need no change.

Storage: replace `better-sqlite3` with **D1** (if the dashboard lands on
Cloudflare) or **Postgres/Neon** (if it lands on Vercel). Note that hosting the
*dashboard* on Cloudflare is optional and the harder path — it needs the
OpenNext adapter, D1, and full removal of the `child_process` wrangler calls.
The workers must be on Cloudflare; the dashboard does not have to be. Pick
whichever gets to a URL fastest.

## 6. Secret custody — read this before committing

In managed mode we hold other people's Zotero and OpenAlex keys. This is
manageable for a lab but should be a deliberate decision, not a side effect.

- Cloudflare worker secrets **cannot be read back** once set. Since we need the
  secrets again to redeploy on update, we must either keep our own encrypted
  copy (what `secrets` table + AES-256-GCM does today) or force re-entry on
  every update. Keeping the encrypted copy is the right call — but it means the
  app's `ENCRYPTION_KEY` is now the crown jewel for everyone, not just one user.
- Put `ENCRYPTION_KEY` in a real secret store, not `.env` on the host.
- Tell users plainly what is stored and where — a short paragraph on the
  settings page is enough for a lab, and it is the honest thing to do.
- Where the upstream API supports it (Zotero does), guide users toward
  **read-only, scoped** keys in the field help text.
- BYO-Cloudflare mode should be presented as the answer for anyone uncomfortable
  with the above, which is another reason to keep Model C alive.

## 7. MCP protocol version — not a blocker

Checked directly against the bundles in `workers/`: both `paper-search-mcp.mjs`
and `zotero-assistant-mcp.mjs` ship an SDK carrying protocol revisions through
`2025-11-25`, and negotiate down to whatever the client requests
(`SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion :
LATEST_PROTOCOL_VERSION`). The OAuth wrapper already implements the
resource-server discovery the newer revisions require.

So the instinct that "these still work with Claude, so I probably don't need to
change much here" is correct. Re-verify against the current spec before any
public launch, but do not sequence any of the work above behind it.

## 8. Target onboarding experience

What a lab mate does, end to end:

1. Open `mcp.ourlab.org`, sign in with their university Google account.
2. See a catalog: *Zotero Assistant*, *Paper Search*.
3. Click **Enable** on Zotero. A form asks for their Zotero API key with a help
   link, and validates it live against the Zotero API (`TestSpec` — already
   built) before allowing submit.
4. We deploy a worker into our account under their namespace.
5. They get a **Add to Claude** panel: the URL with token, a copy button, and
   three lines of instructions.

No clone, no npm, no Node, no Cloudflare account, no wrangler login. When we
ship an MCP update, we redeploy their worker and they notice nothing.

## 9. Suggested sequencing

Each phase is independently shippable and useful on its own.

| Phase | Work | Unblocks |
|---|---|---|
| **1** ✅ | Consolidate on `CloudflareDeployService`; retire the `wrangler` shell-out from the deploy path; feed real `cf_token` / `cf_account_id` from env | Anything hosted at all |
| **2** ◐ | Move storage off local SQLite to D1/Postgres; deploy the dashboard to a URL | Kills the install/update pain — **biggest win per unit of work** |
| **3** | Add auth + `users` table; add `user_id` to `deployments` / `secrets` | Multi-user |
| **4** | Namespace worker names per user; implement managed deployment target | Model B |
| **5** | Per-user BYO-Cloudflare setting in Settings | Model C preserved |
| **6** | "Update all deployments" — redeploy every user's worker on a new release | The update pain, solved centrally |

Phases 1–2 alone deliver most of the stated value and require no decision about
secret custody. That is a good place to start regardless of how the Model B
question ultimately lands.

## 10. Decision — 2026-08-07

**Build Model B on a free (or $5) Cloudflare account. Get it working. Defer the
scaling choice.**

Rationale: the ceiling is ~33 users free and ~165 paid, which is comfortably
past a lab's size, and Model D exists as a configuration-level escape hatch if
we ever approach it. Pooling (Model A) is rejected on contract and custody
grounds, not effort — and notably, the effort argument that originally justified
rejecting it turned out to be wrong, so if we ever revisit it, revisit it on the
real grounds.

What this decision does *not* commit us to: any pooling work, any Workers for
Platforms spend, and any secret-custody decision until phase 3.

Sequencing follows §9 unchanged. Phases 1–2 are the next work: consolidate on
`CloudflareDeployService`, retire the `npx wrangler` shell-out in
`src/lib/wrangler.ts`, move storage off `better-sqlite3`, and get the dashboard
to a URL. Everything through phase 2 is single-user and reversible.

Two things to check before phase 4, neither blocking now:

- Confirm the 100/500 script limits and the $5 paid tier against current
  Cloudflare pricing — the numbers here are from the original draft.
- If we ever pick up Model D, run the Durable Object namespace test in §3
  *first*. It is go/no-go for that path.

## 11. Phase 1 as built — 2026-08-07

Shipped. `operations.ts` now constructs a `CloudflareDeployService`, so deploys,
secrets, KV and worker deletion all run over the REST API. `wrangler.ts` went
from 562 lines to 196 and holds only login and token refresh.

Four things the plan above did not anticipate:

- **The routes had moved *off* `CloudflareDeployService`.** §2 said they used
  it, which was true when written. An uncommitted refactor — invisible to git
  because `core.ignoreStat` was set — had since routed them through
  `operations.ts` onto the wrangler shell-out, leaving the REST service with
  zero importers. Phase 1 was therefore less "consolidate" and more "point the
  shared layer at the other backend". Keeping `operations.ts` as the shared
  CLI/GUI seam was right; only its backend was wrong.

- **The REST service had no KV support at all**, which OAuth deploys require.
  Added `ensureKVNamespace`, plus a `kvNamespaceId` argument on `deployWorker` —
  the script-upload API expresses KV bindings as
  `{type: "kv_namespace", namespace_id}` inside `bindings`, not as the
  top-level `kv_namespaces` array with an `id` field that wrangler.jsonc uses.

- **Wrangler's OAuth token lasts one hour.** Reading it off disk alone would
  have broken local deploys hourly. An expired token now triggers the cheapest
  wrangler command so wrangler exchanges its refresh token, then re-reads. This
  is why the shell-out survives for auth: `wrangler login` still works
  unchanged for local users, and hosted deployments never take this path.

- **`validateToken()` cannot resolve the account for an OAuth token.** It calls
  `user.tokens.verify()`, which is API-token-only and answers
  `401 Invalid API Token`. `accounts.list()` accepts both.

Credentials now resolve in three tiers: `CLOUDFLARE_API_TOKEN` from the
environment (how a hosted deployment supplies the single account it owns), then
an encrypted token in `config`, then wrangler's OAuth token. Phase 4's
`DeploymentTarget` slots in above this without disturbing it.

One security note for whoever does phase 4: worker and secret names are
interpolated into Cloudflare API paths, and worker names come from a third
party's `mcp-deploy.json`. The wrangler path validated them against shell
injection; the REST path needed the same validation against URL path
injection. Both validators now live on `CloudflareDeployService`. Any new
method that puts a caller-supplied name into a URL needs them too.

## 12. Phase 2 storage interface as built — 2026-08-09

Half of phase 2 shipped: the storage seam. Everything mcp-deploy persists now
goes through an async `Store` interface (`store-types.ts`). The local tool
backs it with `SqliteStore` (`sqlite-store.ts`); a hosted deployment calls
`setStore()` at startup to plug in D1 or Postgres, and `operations.ts` plus the
route handlers run against it unchanged. `store.ts` is now a thin delegating
facade over the active backend.

Why async: D1 and Postgres are both async — and D1 is async even though it is
SQLite underneath, which also makes it the lower-friction hosted backend
(identical SQL dialect to the local `better-sqlite3`, so one query layer serves
both). better-sqlite3 stays the local backend; no Node-version change, and
swapping the local engine (e.g. `node:sqlite`) is still a separate decision.

**Still open for phase 2:**

- **`oauth/store.ts` is not yet behind the interface.** It still calls `getDb()`
  directly and is synchronous. The OAuth clients/codes and JWT-secret storage it
  owns must move behind the `Store` seam (or a sibling interface) before
  OAuth-protected deploys can run in a hosted, non-SQLite environment. This is
  the last hard binding to local SQLite in the deploy path.
- **Deploy the dashboard to a URL.** Untouched. Note this cannot ship before the
  dashboard has auth (phase 3) — see the CSRF/loopback work already done, which
  protects the *local* dashboard but is not a substitute for real auth on a
  public URL.
