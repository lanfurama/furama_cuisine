# Calling Vertex AI (Gemini + Claude-on-Vertex) from the Next.js 16 / Vercel app for auto-translate, writing assistant, SEO meta and image alt text, with admin-editable model/region/prompt config

All package facts below come from the published npm tarballs, downloaded with `npm pack` into the scratchpad (nothing was installed into the project): `SP=/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/pkgs`. Google model, region, price and quota facts were scraped on 2026-10-01 from docs.cloud.google.com. Those pages now live under `/gemini-enterprise-agent-platform/...` and showed "Last updated 2026-10-01".

## 1. Packages and compatibility (verified with npm view, 2026-10-01)
| Package | Latest | Notes |
|---|---|---|
| `ai` | **7.0.126** | ESM-only, Node >= 22 (`docs/08-migration-guides/23-migration-guide-7-0.mdx:107-140`) |
| `@ai-sdk/google-vertex` | **5.0.101** (`latest`). The `ai-v6` tag is 4.0.210, so the **5.x line is the one for ai@7** | deps: `@ai-sdk/google@4.0.87`, `@ai-sdk/anthropic@4.0.71`, `google-auth-library@^10.6.2`; peer `zod ^3.25.76 \|\| ^4.1.8`; engines node >= 22 |
| `@ai-sdk/react` | 4.0.129 | pins `ai: 7.0.126`; peer react `^19.2.1` covers React 19.3 |
| `zod` | 4.6.5 | |
| `@vercel/oidc` | 3.8.9 | already in node_modules as a transitive dep of `@vercel/functions@3.9.9`. Add it as a direct dep. `@vercel/functions/oidc` is **deprecated** ("Use @vercel/oidc instead", `node_modules/@vercel/functions/oidc/index.d.ts`) |
| `google-auth-library` | 11.1.0 latest, but the provider depends on `^10.6.2` (10.9.1 resolves) | add it as a direct dep pinned to `^10.9` so `ExternalAccountClient` and the provider share one copy |
| `@vercel/firewall` | 1.2.5 | `checkRateLimit(id, { rateLimitKey })` |

AI SDK 7 changes that bite here (migration guide):
- `system` is now `instructions` (:316).
- System messages inside `messages` are rejected by default (:445).
- `fullStream` is now `stream` (:962), and `onFinish` is now `onEnd` (:596).
- The `{type:'image'}` part is deprecated. Use `{ type: 'file', mediaType: 'image/jpeg', data }` (:1413).
- `result.toTextStreamResponse()` and similar are deprecated. Use the stateless `toTextStream({stream: result.stream})` + `createTextStreamResponse({stream})` (:1645).
- `usage` now covers all steps, and `totalUsage` is deprecated (:1447).
- **`generateObject`/`streamObject` are deprecated**: `dist/index.d.ts:8219,8640` say "Use `generateText` with an `output` setting instead". Use `generateText({ output: Output.object({ schema }) })` and read `result.output`.
- A new top-level `reasoning: 'none'|'minimal'|'low'|'medium'|'high'|'xhigh'` maps to Gemini `thinkingLevel` and Claude `effort` (`google-language-model.ts:1345-1380`, `anthropic-language-model.ts:3431-3500`).

Vercel's official GCP OIDC doc (last_updated 2026-09-01) still shows `createVertex` (now a deprecated alias) and `gemini-1.5-flash`. Don't copy its model id.

## 2. Exact import paths and model ids (`@ai-sdk/google-vertex@5.0.101`)
- **Gemini:** `import { createGoogleVertex, googleVertex } from '@ai-sdk/google-vertex'`. `createVertex` and `vertex` are deprecated aliases (`src/index.ts:21-28`). Model ids are plain strings, e.g. `googleVertex('gemini-3.8-flash')`. Provider options key: `googleVertex` (legacy `vertex` also read; falls back to `google`) (`@ai-sdk/google src/google-language-model.ts:164-190`). Gemini receives a full JSON Schema via `responseJsonSchema` (:412-420).
- **Claude on Vertex:** `import { createGoogleVertexAnthropic, googleVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'`. `createVertexAnthropic` and `vertexAnthropic` are deprecated aliases (`src/anthropic/index.ts`).
  - Ids are bare first-party ids: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5` (Google's use-claude page lists exactly these; no `@date` for current models).
  - Calls go to `https://{host}/v1/projects/{p}/locations/{loc}/publishers/anthropic/models/{id}:rawPredict|streamRawPredict` with `anthropic_version: 'vertex-2023-10-16'` (`google-vertex-anthropic-provider.ts:213-233`).
  - Provider options key: `anthropic` (canonical) **and** `googleVertex` (the provider name prefix), both parsed with the Anthropic schema (`anthropic-language-model.ts:373-399`). So build providerOptions per family and never put Gemini options under `googleVertex` on a Claude call.
- **Host mapping (both families):**
  - `global` → `aiplatform.googleapis.com`
  - `us`/`eu` → `aiplatform.{us|eu}.rep.googleapis.com`
  - anything else → `{region}-aiplatform.googleapis.com`
  - Location must be a single DNS label (`google-vertex-provider-base.ts:230-277`).
- **Footgun:** the Anthropic sub-provider reads project and location with `loadOptionalSetting`. If either is unset, it silently builds `https://undefined-aiplatform.googleapis.com/...` (`google-vertex-anthropic-provider.ts:187-213`). Always pass both explicitly.
- **Env vars the provider reads:**
  - `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`.
  - `GOOGLE_VERTEX_API_KEY`: express mode. Gemini only; not usable for tuned/Interactions models, and the Anthropic sub-provider has no API-key path.
  - `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PRIVATE_KEY_ID` are read **only by the `/edge` entry points** (`src/edge/google-vertex-auth-edge.ts:29-47`). The Edge path fetches a new OAuth token on every call, with no cache.
  - The **Node** entry uses google-auth-library, which only auto-reads `GOOGLE_APPLICATION_CREDENTIALS` (a file path) and `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT`. On Node you must pass `googleAuthOptions.credentials` or `authClient` yourself.
  - Use the Node runtime (the Next.js default), not `/edge`.
- **Overriding auth:**
  - The Gemini provider accepts `googleAuthOptions` (`authClient`, `credentials`, ...).
  - The Anthropic provider accepts `googleAuthOptions` **or** `generateAuthToken: () => Promise<string|null>` (`google-vertex-anthropic-provider-node.ts:19-31`).
  - Passing `googleAuthOptions: { authClient }` works for both and reuses that client's token cache (`src/google-vertex-auth-google-auth-library.ts`).

## 3. Structured output: translate a JSON of fields in one call
- Use `generateText({ model, instructions, prompt, output: Output.object({ schema }) })`.
- **Use a stable schema rather than a dynamic per-field object:** `z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) })`.
  - Mask ids to short keys and map them back server-side.
  - Validate that every id comes back exactly once.
  - Why: Claude compiles each new schema once and caches it for 24 h (claude-api skill `shared/tool-use-concepts.md` "Important Notes"). Vertex docs list `z.record`/`z.union` as problematic for Gemini (`docs/16-google-vertex.mdx` "Schema Limitations").
  - Don't put `.max()`/`.min()` in the schema: Claude JSON Schema doesn't support `minLength`/`maxLength`/`minimum`. Enforce lengths (SEO title <= 60, description <= 155) after generation.
- **Claude-on-Vertex gotcha #1 (verified in source):**
  - The Vertex Anthropic provider sets `supportsNativeStructuredOutput: false` ("force the use of JSON tool fallback ... since beta header isn't supported", `google-vertex-anthropic-provider.ts:237-240`). So by default the SDK sends a `json` tool with `toolChoice: 'required'`.
  - `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-fable-5-1` **reject forced tool use** (`getModelCapabilities`, `anthropic-language-model.ts:3180-3215`). `prepareTools` therefore downgrades it to `tool_choice: auto` with only a warning (`anthropic-prepare-tools.ts:489-505`).
  - The auto-fallback to native outputs needs `supportsNativeStructuredOutput`, which is false on Vertex (:455-485).
  - Result: no guarantee the model calls the tool, so you risk `NoObjectGeneratedError`.
  - **Fix:** pass `providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } }`. This makes `useStructuredOutput` true regardless (:462-465) and sends GA `output_config.format` with no beta header (:715-735).
- **Claude-on-Vertex gotcha #2 (verified in Google docs):** "By default, structured outputs are disabled by the organization policy constraint `constraints/vertexai.allowedPartnerModelFeatures`". The control-model-access page qualifies this: "For projects that belong to an organization, this feature is denied by default and must be explicitly allowed". With no policy set or inherited, all actions are allowed.
  - If the GCP project sits under an Organization, set the policy `allowedValues: [publishers/anthropic/models/MODEL:structured_outputs]` (or `publishers/anthropic`).
  - Structured outputs are supported on Vertex for Claude 4.5+.
- Gemini: structured output is on by default (`structuredOutputs` option, default true).
- Refusals: Claude `stop_reason: refusal` maps to `finishReason: 'content-filter'` (`map-anthropic-stop-reason.ts`). Server-side `fallbacks` are **not** available on Vertex (claude-api skill `shared/platform-availability.md`).
- Sampling params (temperature/topP/topK) are dropped with a warning on Opus 5.5 / Sonnet 5.5 (`rejectsSamplingParameters`). Don't expose temperature in admin for Claude.

## 4. Image input (alt text on upload)
- Message part: `{ role:'user', content:[{type:'text', text:'...'}, {type:'file', mediaType:'image/jpeg', data: buffer}] }`.
- **Gemini:** `supportedUrls` includes `https?://` and `gs://`, so URLs are passed through to Vertex rather than downloaded (`google-vertex-provider-base.ts:313-320`). Whether Vertex reliably fetches arbitrary public URLs was **not verified**; send bytes.
  - `providerOptions.googleVertex.mediaResolution: 'MEDIA_RESOLUTION_LOW'` cuts image tokens.
  - `labels: { app: 'furama-cms', feature: 'alt-text' }` gives billing attribution (Vertex only).
- **Claude:** `supportedUrls: {}`, so the SDK downloads and base64-encodes. Vertex limit: **5 MB per image, 100 images per request** (Google use-claude page).
- Resize to about 1024 px long edge (JPEG/WebP) with `sharp` before the call. Add `sharp` as a direct dep; it is currently only Next's optional dep.
- Server Actions cap request bodies at **1 MB by default** (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` "bodySizeLimit"). Upload the image directly to storage (e.g. Vercel Blob client upload) and run alt-text server-side on the stored bytes, e.g. in `after()`.

## 5. Streaming for the writing assistant
Route Handler (not a Server Action), e.g. `app/api/admin/ai/assist/route.ts`:
```ts
export const maxDuration = 60;
export async function POST(req: Request) {
  const user = await requireRole(['admin','editor']);      // check auth in the handler itself
  await enforceAiLimits(user.id, 'assist');
  const { text, mode } = AssistInput.parse(await req.json()); // server-side length cap
  const cfg = await getAiSettings();
  const result = streamText({
    model: vertexModel(cfg.features.assist),
    instructions: cfg.features.assist.instructions + MODE[mode],
    prompt: text,
    reasoning: 'low',
    maxOutputTokens: cfg.features.assist.maxOutputTokens,
    maxRetries: 1,
    abortSignal: req.signal,                 // closing the panel stops billing
    providerOptions: providerOptionsFor(cfg.features.assist.family, 'assist'),
    onEnd: (e) => recordUsage(user.id, 'assist', e.usage),
  });
  return createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) });
}
```
- Client: `useCompletion({ api: '/api/admin/ai/assist', streamProtocol: 'text' })` from `@ai-sdk/react` (`dist/index.d.ts:176`; `streamProtocol: 'data'|'text'`).
- Claude Opus 5.5 always thinks. The default is effort `medium`, and `reasoning:'none'` becomes effort `low`. On Sonnet 5.5, `'none'` becomes `between_tools`.
- With Opus 5.5 the default `display` is omitted, so expect a short pause before text starts.

## 6. Authentication on Vercel
**(a) Service-account JSON key in env.**
- Node: `createGoogleVertex({ project, location, googleAuthOptions: { credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g,'\n') } } })`.
- Simple, but it is a long-lived secret.
- Many Google Cloud Organizations enforce `iam.disableServiceAccountKeyCreation` (unverified for this account).

**(b) Vercel OIDC to GCP Workload Identity Federation (keyless). Recommended.**
- Vercel doc https://vercel.com/docs/oidc/gcp (2026-09-01):
  1. Pool `vercel` with an OIDC provider `vercel`.
  2. Issuer: team mode `https://oidc.vercel.com/[TEAM_SLUG]`, or global `https://oidc.vercel.com`.
  3. Audience: either "Allowed audiences" `https://vercel.com/[TEAM_SLUG]`, or the GCP default audience. With the default audience, pass `getVercelOidcToken({ audience: GCP_AUDIENCE })`.
  4. Attribute mapping: `google.subject = assertion.sub`.
  5. Service account principal: `principal://iam.googleapis.com/projects/NUM/locations/global/workloadIdentityPools/vercel/subject/owner:TEAM:project:PROJECT:environment:ENV`.
  6. Env vars: `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`.
- Grant the federated principal **`roles/iam.workloadIdentityUser`** on the SA (GCP WIF doc, updated 2026-09-24). Grant the SA **`roles/aiplatform.user`** on the project.
- Enable the IAM Service Account Credentials and STS APIs. This is standard for WIF but was not re-verified this session.
- **This project already has OIDC active** (`.env.local` contains `VERCEL_OIDC_TOKEN`). Decoded non-secret claims:
  - `iss=https://oidc.vercel.com/lannguyenvkus-projects` (team issuer mode)
  - `aud=https://vercel.com/lannguyenvkus-projects`
  - `sub=owner:lannguyenvkus-projects:project:furama-cuisine:environment:development`
  - Grant subjects for `production` and `development`. Decide about `preview`.
  - The local token expired 2026-09-30. `getVercelOidcToken()` refreshes in dev using the Vercel CLI login, or run `vercel env pull`.
- Token lifecycle:
  - At runtime the token comes from the `x-vercel-oidc-token` request header, falling back to the `VERCEL_OIDC_TOKEN` env var (`@vercel/oidc dist/get-vercel-oidc-token-sync.js`).
  - Vercel reuses a token for up to 90 min, with a 2 h TTL (vercel.com/docs/oidc).
  - The external-account client defaults to the cloud-platform scope and caches the GCP access token until expiry (`google-auth-library build/src/auth/baseexternalclient.js:32,134,196`).
- **Bug trap in Vercel's sample:** it passes `getSubjectToken: getVercelOidcToken` bare.
  - google-auth-library calls `getSubjectToken(this.supplierContext)`, where the context is `{audience: '//iam.googleapis.com/projects/.../providers/...', subjectTokenType, transporter}` (`identitypoolclient.js:114`, `baseexternalclient.js:156-160`, v10.9.1).
  - `@vercel/oidc` 3.8 treats `options.audience` as a request to **exchange** the token at `https://oidc.vercel.com/~token` for that audience (`get-vercel-oidc-token-with-refresh.js`, `exchange-vercel-oidc-token.js`). That yields an `aud` your provider probably doesn't allow.
  - Always wrap it: `getSubjectToken: () => getVercelOidcToken()`, or `() => getVercelOidcToken({ audience: GCP_AUDIENCE })` in default-audience mode.

Shared auth singleton (Node, `server-only`):
```ts
import { ExternalAccountClient, JWT, type AuthClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
let auth: AuthClient | undefined;
export function getAuthClient(): AuthClient {
  if (auth) return auth;
  if (process.env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    auth = ExternalAccountClient.fromJSON({
      type: 'external_account',
      audience: `//iam.googleapis.com/projects/${process.env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${process.env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${process.env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() }, // wrapped on purpose
    })!;
  } else {
    auth = new JWT({ email: process.env.GOOGLE_CLIENT_EMAIL, key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return auth;
}
```

## 7. Models, regions, prices, quotas (Google model cards and pricing page, 2026-10-01)
Gemini (`createGoogleVertex`). Prices are USD per 1M tokens, input/output, at the **global** endpoint. Non-global (`us`/`eu`/regional) is +10%.

| Model id | Stage | Endpoints | Price | Fit |
|---|---|---|---|---|
| `gemini-3.8-flash` | GA 2026-09-02 | global, us, eu only | **$0.75/$3.75 intro through 2026-12-31**, then $1.50/$7.50 | **default** for translate, SEO, alt text, assist |
| `gemini-3.5-flash-lite` | GA 2026-07-21, retire >= 2027-07-21 | global, us, eu | $0.30/$2.50 | budget alt text / SEO |
| `gemini-3.1-flash-lite` | GA 2026-05-07, retire >= 2027-05-07 | global, us, eu | $0.25/$1.50 | cheapest |
| `gemini-3.5-flash` | GA 2026-05-19 | global, us, eu, plus regional incl. **asia-southeast1** | $1.50/$9.00 | only if a regional endpoint is required |
| `gemini-3.1-pro-preview` | Public preview | global only | $2/$12 | not for production |
| `gemini-2.5-flash` | **retires 2026-10-20** | | | avoid |

- Flex PayGo is 50% off on global only (`providerOptions.googleVertex.sharedRequestType: 'flex'`). Gemini 3.8 Flash has a Flex/Batch price ($0.375 intro input). Use it for bulk "translate whole site" jobs.
- AI SDK `experimental_startBatch` does not list Vertex (`docs/03-ai-sdk-core/42-batch.mdx`).

Claude (`createGoogleVertexAnthropic`). Each model must be **enabled from its Model Garden card** ("click Enable", Marketplace terms). Billing accounts managed by prohibited resellers can't enable it.

| Model id | GA | Endpoints | Global price | Default quota |
|---|---|---|---|---|
| `claude-opus-5-5` | 2026-09-22 | **global, us, eu** (ML processing may occur in US, EU and asia-southeast1) | $4/$20 (us/eu $4.40/$22) | global 2,000 QPM / 20M in-TPM / 2M out-TPM; multi-region 1,000 QPM |
| `claude-sonnet-5-5` | 2026-09-28 | global, us, eu | $2/$10 (us/eu $2.20/$11) | multi-region 1,250 QPM |
| `claude-haiku-4-5` | 2025-10-15 | us-east5, europe-west1, global | $1/$5 | global 2,500 QPM. **Retirement "not sooner than 2026-10-15"**: don't make it a default |

- No asia-southeast1 or us-east5 endpoint for the 5.5 models.
- Claude models launched after 2026-05-26 use **shared lineage quotas** (e.g. one `anthropic-claude-opus` bucket per endpoint across versions; global and multi-region buckets are independent).
- The default Claude choice in the catalog is `claude-opus-5-5`. Sonnet 5.5 is a selectable alternative; that cost tradeoff is the admin's call.
- **Region recommendation:** `global` for both families. It is cheapest (no 10% premium), has the highest quota, and is available for every recommended model. Expose `us`/`eu` only if data-residency is required.

## 8. Admin-editable config to provider at request time
- **Model catalog in code** (`lib/ai/catalog.ts`), not free text: `{ id, family:'gemini'|'claude', locations:[...], vision, priceIn, priceOut, status, retireAfter? }`.
  - Admin dropdowns are filtered by this catalog.
  - Zod `superRefine` requires the location to be one of `catalog[model].locations` and `vision` for alt text.
  - Update the catalog in code when Google retires models.
- **Settings in Postgres:** an `ai_settings` single row (JSONB, versioned, each change written to `audit_log`) validated with Zod. Per feature (`translate`, `assist`, `seo`, `altText`): `{ enabled, modelId, location, reasoning:'minimal'|'low'|'medium', maxOutputTokens, instructions }`. Plus `limits: { perUserPerMinute, perUserPerDay, monthlyBudgetUsd }`.
- **Glossary** in its own table `ai_glossary(term, mode:'keep'|'map', per_locale jsonb, note)`. Examples: keep 'Tàya House' and 'Phố Cuốn'; map 'Da Nang' to `{vi:'Đà Nẵng'}`.
- **No GCP secrets in the DB.** The settings page shows only which env vars are present (booleans) and the project id.
- **Read settings per request** with React `cache()`, or `'use cache'` + `cacheTag('ai-settings')` and `updateTag('ai-settings')` in the save Server Action. `updateTag` is Server-Action-only (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md`).
- **Factory:** memoize providers in a module `Map` keyed `${family}|${location}`, all sharing `getAuthClient()`:
```ts
export function vertexModel(f: { family: 'gemini'|'claude'; modelId: string; location: string }): LanguageModel {
  const project = process.env.GCP_PROJECT_ID!; const key = `${f.family}|${f.location}`;
  let p = providers.get(key);
  if (!p) { const googleAuthOptions = { authClient: getAuthClient(), projectId: project };
    p = f.family === 'gemini' ? createGoogleVertex({ project, location: f.location, googleAuthOptions })
                              : createGoogleVertexAnthropic({ project, location: f.location, googleAuthOptions });
    providers.set(key, p); }
  return p(f.modelId);
}
export const providerOptionsFor = (family, feature) => family === 'claude'
  ? { anthropic: { structuredOutputMode: 'outputFormat' } }
  : { googleVertex: { labels: { app: 'furama-cms', feature }, ...(feature === 'altText' && { mediaResolution: 'MEDIA_RESOLUTION_LOW' }) } };
```

## 9. "Test connection" Server Action (admin only)
1. Check required env (booleans).
2. `await getAuthClient().getAccessToken()`. This isolates STS/IAM failures, e.g. `iam.serviceAccounts.getAccessToken denied`, which means workloadIdentityUser is missing.
3. Text probe: `generateText({ model, prompt:'Reply with OK', maxOutputTokens: 256, reasoning:'minimal', maxRetries:0, timeout:{ totalMs: 20000 } })`. Keep 256 rather than 16, because Opus 5.5 always thinks.
4. Structured probe: `Output.object({schema: z.object({ok: z.boolean()})})`. This catches the Claude org-policy denial and the jsonTool issue.
5. Optional vision probe with a tiny bundled JPEG.
6. Return `{ ok, latencyMs, modelId, location, usage, warnings }`.
7. Map `APICallError.isInstance(e)` by `statusCode`:
   - 401/403: IAM role, or model not enabled in Model Garden.
   - 404: model not offered at that location.
   - 429: quota.
   - 400: params or org policy.
8. Optionally block saving settings until the probe passes.

## 10. Cost guardrails
- Server-side input caps (chars) and per-feature `maxOutputTokens`, e.g. assist 1,024, SEO 400, alt 200, translate about 2x source tokens + 500 with an 8k ceiling. Add `maxRetries: 1`, `timeout`, `abortSignal: req.signal`, and `maxDuration` on routes.
- `reasoning: 'minimal'|'low'` by default. Thinking tokens bill as output on both families.
- Use the `global` endpoint, Flex for bulk jobs, and Vertex `labels` for cost attribution.
- **Usage ledger** `ai_usage(user_id, feature, model, location, input_tokens, output_tokens, est_cost_usd, created_at)`, written in `onEnd`/after `generateText`. Before each call, check per-user per-minute and per-day counts and the month-to-date total against `monthlyBudgetUsd`, with a hard stop.
- Optional burst limiter: `@vercel/firewall` `checkRateLimit('ai-admin', { rateLimitKey: user.id })`. It needs a matching WAF rule configured in the dashboard; plan requirements were not verified.
- Backstops in GCP: Billing budget alerts (alert only) and lowered Vertex QPM/TPM quota overrides (a hard cap).
- Exclude preview deployments from the WIF principal, or give them a separate low budget.

## 11. Translation workflow specifics
- Mask glossary terms with placeholders (e.g. `⟦G1⟧`) before sending. Verify every placeholder returns, then restore. Also NFC-normalize both sides and re-check 'Tàya House' and 'Phố Cuốn' verbatim.
- Put the glossary and brand voice in `instructions`, a stable prefix that benefits Gemini implicit caching. Claude's minimum cacheable prefix (1,024+ tokens) likely won't be reached.
- Send context hints per item (`heading`, `nav label`, `button`, `body`, maxChars). Check that HTML/markdown tags are preserved.
- Save results as `status='machine'` with `source_hash` and `model_id`. The editor reviews them, and stale translations are flagged when the EN source hash changes.
- Prefer `zh-Hans`/`zh-Hant` locale codes over a bare `zh`.

## Sources
- npm tarballs in `$SP`:
  - `ai-7.0.126`
  - `ai-sdk-google-vertex-5.0.101` (src + `docs/16-google-vertex.mdx`)
  - `ai-sdk-anthropic-4.0.71`
  - `ai-sdk-google-4.0.87`
  - `gal` (google-auth-library 10.9.1)
  - `react` (@ai-sdk/react 4.0.129)
  - `fw` (@vercel/firewall 1.2.5)
- Project `node_modules/@vercel/oidc`, `node_modules/@vercel/functions/oidc`, `node_modules/next/dist/docs/...`
- https://vercel.com/docs/oidc/gcp and https://vercel.com/docs/oidc
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/{opus-5-5,sonnet-5-5,haiku-4-5,opus-5,use-claude,quotas,structured-outputs}
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/control-model-access
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/{3-8-flash,3-5-flash-lite,3-1-flash-lite,3-1-pro,3-5-flash,2-5-flash}
- https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- claude-api skill `shared/platform-availability.md` and `shared/tool-use-concepts.md`

## Recommendation
Call Vertex directly from the server: a Node runtime Route Handler or Server Action. Use ai@7.0.126 and @ai-sdk/google-vertex@5.0.101, with @ai-sdk/react@4.0.129, zod@4, and google-auth-library@^10.9 plus @vercel/oidc@^3.8.9 as direct deps.

**Authentication:** use keyless Vercel OIDC to GCP Workload Identity Federation. OIDC is already active on this project in team issuer mode.
- Create pool/provider `vercel` with issuer https://oidc.vercel.com/lannguyenvkus-projects and allowed audience https://vercel.com/lannguyenvkus-projects.
- Map google.subject=assertion.sub.
- Grant roles/iam.workloadIdentityUser on a dedicated service account to the production and development subjects.
- Give that service account roles/aiplatform.user.
- Build one module-level ExternalAccountClient with `getSubjectToken: () => getVercelOidcToken()` (wrapped, not passed bare) and share it as `googleAuthOptions.authClient`.
- Keep a service-account key (GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY passed manually via `googleAuthOptions.credentials`) only as a fallback. Never store GCP secrets in the database.

**Model and region defaults:**
- `gemini-3.8-flash` on the `global` endpoint for translate, SEO meta, alt text and the writing assistant. It is cheapest and needs no Model Garden enablement or org-policy work.
- `gemini-3.5-flash-lite` as the budget option.
- Claude as an opt-in family: default `claude-opus-5-5`, with `claude-sonnet-5-5` selectable. Each must be enabled in Model Garden and always called with `providerOptions.anthropic.structuredOutputMode: 'outputFormat'`. If the GCP project is under an Organization, also allow the `structured_outputs` partner feature in org policy.
- Don't default to claude-haiku-4-5 or gemini-2.5-flash; both are near retirement.

**AI calls:**
- Use `generateText` with `Output.object`, since generateObject is deprecated.
- Translation uses a stable `{items:[{id,text}]}` schema, with glossary placeholder masking and post-validation. Results are saved as machine drafts for editor review.
- The writing assistant streams through a Route Handler (`streamText` → `toTextStream` → `createTextStreamResponse`), consumed by `useCompletion({ streamProtocol: 'text' })`.

**Admin config:**
- Map Zod-validated `ai_settings` (per-feature enabled, modelId, location, reasoning, maxOutputTokens, instructions; plus limits) against an in-code model catalog to memoized providers keyed by family and location.
- Add a test-connection action that probes the token, text, structured output and vision, and classifies errors.

**Cost guardrails:**
- Server-side input and output caps, `reasoning: 'minimal'|'low'`, the global endpoint, and Flex for bulk jobs.
- A Postgres `ai_usage` ledger enforcing per-user per-minute and per-day limits plus a monthly USD budget.
- GCP quota overrides and budget alerts as backstops.

## Risks
- The AI SDK's default structured output for Claude on Vertex uses a JSON tool, which Opus 5.5 and Sonnet 5.5 can't force. The SDK degrades it to tool_choice auto with only a warning, which risks NoObjectGeneratedError. Must set structuredOutputMode:'outputFormat'.
- If the GCP project belongs to an Organization, Claude structured outputs (and web search) are denied by default until vertexai.allowedPartnerModelFeatures allows them. Translation, SEO and alt-text calls on Claude would fail with 4xx.
- Vercel's GCP sample passes getVercelOidcToken bare as getSubjectToken. That triggers an audience exchange to //iam.googleapis.com/..., which an 'allowed audiences = https://vercel.com/<team>' provider will likely reject. Wrap it in a lambda.
- The Anthropic sub-provider builds https://undefined-aiplatform.googleapis.com when project or location is unset, giving confusing DNS/404 errors. Always pass both explicitly.
- Using the /edge entry points re-fetches an OAuth token on every request (no cache), adding latency. Use the Node runtime.
- Model churn: gemini-2.5-flash retires 2026-10-20; claude-haiku-4-5 retires no sooner than 2026-10-15; the gemini-3.8-flash intro price doubles on 2027-01-01. The in-code catalog and price table need maintenance.
- Gemini 3.8 Flash and the Claude 5.5 models have no single-region endpoints (no asia-southeast1, us-central1 or us-east5); only global, us and eu work. A free-text region field would let admins save broken configs. The global endpoint may process data outside the US/EU (e.g. asia-southeast1 for Claude).
- Claude on Vertex lacks server-side refusal fallbacks, the Files API and AI SDK batch support. Refusals surface as finishReason 'content-filter' and need UI handling. Temperature is ignored on Opus/Sonnet 5.5.
- Opus 5.5 always runs adaptive thinking (default effort medium). Tiny maxOutputTokens (e.g. 16 in a test-connection probe) can produce empty or truncated output. Thinking tokens bill as output on both families.
- Many online examples, including Vercel's GCP doc (createVertex, gemini-1.5-flash), predate AI SDK 7. Its renames (instructions, stream, onEnd, file parts, stateless stream helpers, generateObject deprecation) will cause type errors if code is copied.
- Server Actions default to a 1 MB request body, so image upload for alt text must go direct to storage or raise bodySizeLimit. Vercel's own function body limit (about 4.5 MB) was not re-verified this session.
- OIDC in local dev depends on the Vercel CLI login to refresh VERCEL_OIDC_TOKEN (the current local token expired 2026-09-30). The WIF principal must also trust the development subject. Preview deployments get AI access only if their subject is granted.
- Compatibility of AI SDK 7 type declarations with TypeScript 7 (the project uses typescript ^7.0.2) was not verified.
- @vercel/firewall rate limiting requires a matching WAF rule configured in the Vercel dashboard. Plan requirements and limits were not verified; the Postgres ledger is the dependable path.

## Open questions
- Is (or will) the GCP project sit under a Google Cloud Organization (e.g. a Workspace domain)? If yes, the org policy must allow Claude structured_outputs, and service-account key creation may be blocked, so WIF becomes mandatory.
- Do you already have a GCP project and billing account for this? Is the global endpoint acceptable (data may be processed in the US, EU or Asia), or is there a data-residency requirement (e.g. us or eu only)?
- Should Claude be offered at all, or should we start Gemini-only? If Claude is offered, may we enable claude-opus-5-5 and/or claude-sonnet-5-5 in Model Garden (accepting Anthropic Marketplace terms)? Which should be the default for the brand-voice writing assistant?
- Should preview deployments have AI access (and spend), or only production plus local development?
- What monthly AI budget (USD) and per-editor daily limits should the admin settings default to?
- Which locales launch first, and which Chinese script (zh-Hans vs zh-Hant)? This affects glossary per-locale mappings (e.g. 'Da Nang' becomes 'Đà Nẵng' in VI) and prompt style notes.

## Key facts
- [verified] Latest versions on 2026-10-01: ai@7.0.126 and @ai-sdk/google-vertex@5.0.101. The 5.x line pairs with ai@7 (ai-v6 dist-tag is 4.0.210). It depends on @ai-sdk/google@4.0.87, @ai-sdk/anthropic@4.0.71 and google-auth-library ^10.6.2, with peer zod ^3.25.76 || ^4.1.8 and Node >= 22. (npm view ai / @ai-sdk/google-vertex)
- [verified] Import paths: createGoogleVertex/googleVertex from '@ai-sdk/google-vertex' and createGoogleVertexAnthropic/googleVertexAnthropic from '@ai-sdk/google-vertex/anthropic'. createVertex, vertex, createVertexAnthropic and vertexAnthropic are deprecated aliases. (@ai-sdk/google-vertex@5.0.101 src/index.ts:21-28, src/anthropic/index.ts)
- [verified] generateObject and streamObject are deprecated in ai@7. Use generateText/streamText with output: Output.object({schema}) and read result.output. Also renamed: system -> instructions, fullStream -> stream, onFinish -> onEnd. The image part is deprecated in favour of {type:'file', mediaType, data}. (ai@7.0.126 dist/index.d.ts:8219,8640; docs/08-migration-guides/23-migration-guide-7-0.mdx)
- [verified] The Vertex Anthropic provider sets supportsNativeStructuredOutput:false, so structured output defaults to a JSON tool with toolChoice 'required'. Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 reject forced tool use, so it silently degrades to tool_choice auto. providerOptions.anthropic.structuredOutputMode:'outputFormat' forces GA output_config.format. (google-vertex-anthropic-provider.ts:237-240; anthropic-language-model.ts:455-485,715-735; anthropic-prepare-tools.ts:489-505)
- [verified] Claude structured outputs on Vertex are denied by default for GCP projects that belong to an Organization. They must be allowed via the org policy constraint vertexai.allowedPartnerModelFeatures (publishers/anthropic/models/MODEL:structured_outputs). With no policy set, all actions are allowed. (docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/structured-outputs and /models/control-model-access)
- [verified] The Anthropic sub-provider reads project and location with loadOptionalSetting. If either is missing it builds https://undefined-aiplatform.googleapis.com, so always pass both explicitly. (google-vertex-anthropic-provider.ts:187-213)
- [verified] GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_PRIVATE_KEY_ID are auto-read only by the /edge entry points, which fetch a new token per call with no cache. The Node entry uses google-auth-library, which only auto-reads GOOGLE_APPLICATION_CREDENTIALS (a file path). GOOGLE_VERTEX_PROJECT, GOOGLE_VERTEX_LOCATION and GOOGLE_VERTEX_API_KEY (express mode, Gemini only) are read by the provider. (src/edge/google-vertex-auth-edge.ts:29-47; google-vertex-provider-base.ts:217-245; google-auth-library build/src/auth/googleauth.js)
- [verified] Vercel's official GCP OIDC doc gives the env vars GCP_PROJECT_ID, GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WORKLOAD_IDENTITY_POOL_ID and GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID. It uses ExternalAccountClient.fromJSON with getVercelOidcToken from @vercel/oidc and passes it via googleAuthOptions.authClient. (https://vercel.com/docs/oidc/gcp (last_updated 2026-09-01))
- [verified] Passing getVercelOidcToken bare as getSubjectToken triggers an unintended exchange. google-auth-library calls it with {audience:'//iam.googleapis.com/...'}, and @vercel/oidc 3.8 then exchanges the token at oidc.vercel.com/~token for that audience. Wrap it as () => getVercelOidcToken(). (google-auth-library 10.9.1 identitypoolclient.js:114, baseexternalclient.js:156-160; @vercel/oidc dist/get-vercel-oidc-token-with-refresh.js, exchange-vercel-oidc-token.js)
- [verified] @vercel/functions/oidc is deprecated in favour of @vercel/oidc (3.8.9). The OIDC token comes from the x-vercel-oidc-token request header with fallback to the VERCEL_OIDC_TOKEN env var. Vercel reuses a token for up to 90 minutes; its TTL is 2 hours. (node_modules/@vercel/functions/oidc/index.d.ts; @vercel/oidc get-vercel-oidc-token-sync.js; https://vercel.com/docs/oidc)
- [verified] This project already has Vercel OIDC in team issuer mode: iss https://oidc.vercel.com/lannguyenvkus-projects, aud https://vercel.com/lannguyenvkus-projects, sub owner:lannguyenvkus-projects:project:furama-cuisine:environment:development. The local token expired 2026-09-30. (.env.local VERCEL_OIDC_TOKEN (non-secret claims decoded locally))
- [verified] GCP WIF requires granting roles/iam.workloadIdentityUser on the service account to the federated principal. (https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers (updated 2026-09-24))
- [verified] gemini-3.8-flash: GA 2026-09-02, endpoints global/us/eu only. Intro pricing $0.75/$3.75 per 1M through 2026-12-31, then $1.50/$7.50 (global). Non-global endpoints cost +10%. (docs.cloud.google.com/.../models/gemini/3-8-flash; cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- [verified] gemini-3.5-flash-lite costs $0.30/$2.50 (global), retirement on or after 2027-07-21. gemini-3.1-flash-lite costs $0.25/$1.50. gemini-3.1-pro is still gemini-3.1-pro-preview (global only). gemini-2.5-flash retires 2026-10-20. (Gemini model cards + pricing page)
- [verified] claude-opus-5-5 (GA 2026-09-22) and claude-sonnet-5-5 (GA 2026-09-28) are available on global, us and eu only. Global prices are $4/$20 and $2/$10; us/eu add 10%. Opus global quota is 2,000 QPM / 20M input TPM / 2M output TPM. (docs.cloud.google.com/.../partner-models/claude/opus-5-5, sonnet-5-5; pricing page)
- [verified] claude-haiku-4-5 is available on us-east5, europe-west1 and global at $1/$5, with retirement date 'not sooner than October 15, 2026'. (docs.cloud.google.com/.../partner-models/claude/haiku-4-5)
- [verified] Claude models launched after 2026-05-26 use shared lineage quotas (one bucket per lineage per endpoint). Each Claude model must be enabled from its Model Garden card. (docs.cloud.google.com/.../partner-models/claude/quotas and /use-claude)
- [verified] Claude on Vertex has a 5 MB per image limit and allows up to 100 images per request. The AI SDK downloads URL images for Vertex Claude (supportedUrls {}), but passes http(s)/gs URLs through for Gemini. (use-claude page; google-vertex-anthropic-provider.ts:236; google-vertex-provider-base.ts:313-320)
- [verified] The top-level reasoning option maps to Gemini thinkingLevel and Claude effort. 'none' becomes between_tools on Sonnet 5.5 and effort low on Opus 5.5, whose thinking cannot be disabled. (@ai-sdk/google google-language-model.ts:1345-1380; @ai-sdk/anthropic anthropic-language-model.ts:3431-3500)
- [verified] Next.js 16 Server Actions cap request bodies at 1 MB by default (serverActions.bodySizeLimit). updateTag is only callable from Server Actions. (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md; .../04-functions/updateTag.md)
- [verified] Stateless streaming helpers toTextStream and createTextStreamResponse exist in ai@7. useCompletion in @ai-sdk/react 4.0.129 supports streamProtocol 'text'. (ai dist/index.d.ts:9955,9982,5801; @ai-sdk/react dist/index.d.ts:176)
- [likely] Vertex is not among the AI SDK batch providers. Gemini Flex PayGo (50% off, global only) is available via providerOptions.googleVertex.sharedRequestType:'flex'. (ai docs/03-ai-sdk-core/42-batch.mdx; docs/16-google-vertex.mdx; pricing page Flex/Batch tab)
- [likely] WIF also needs the IAM Service Account Credentials API and the STS API enabled. The SA needs roles/aiplatform.user on the project. (standard GCP WIF/Vertex requirements; not re-verified page-by-page this session)