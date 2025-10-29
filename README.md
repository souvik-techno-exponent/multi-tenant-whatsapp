# WhatsApp Multi-Tenant Backend (Node.js + MongoDB + Redis + BullMQ)

> Development-friendly proof-of-concept for a multi-tenant WhatsApp messaging backend.
> Each tenant connects their own WhatsApp phone_number via Meta Cloud API (or simulated tokens in dev),
> incoming messages are routed to the correct tenant, and outbound messages are queued with retries
> and idempotency guarantees.

---

## Table of Contents

-   [Summary](#summary)
-   [Features](#features)
-   [Interactive templates & multi-branch conversations](#interactive-templates--multi-branch-conversations)
-   [Runtime user flow (how it will work)](#runtime-user-flow-how-it-will-work)
-   [Schema changes (what's new)](#schema-changes-whats-new)
-   [API & Webhook changes (what to update)](#api--webhook-changes-what-to-update)
-   [Prerequisites](#prerequisites)
-   [Quickstart (Development)](#quickstart-development)
-   [Environment variables / .env.example](#environment-variables--envexample)
-   [Docker / Compose usage](#docker--compose-usage)
-   [Project layout](#project-layout)
-   [API Reference (curl examples)](#api-reference-curl-examples)
-   [Webhook signature verification (security)](#webhook-signature-verification-security)
-   [Data model (conceptual)](#data-model-conceptual)
-   [Queueing, retries & idempotency](#queueing-retries--idempotency)
-   [Errors & status codes](#errors--status-codes)
-   [Testing & local development tips](#testing--local-development-tips)
-   [Observability & troubleshooting](#observability--troubleshooting)
-   [Production considerations](#production-considerations)
-   [OpenAPI / Postman](#openapi--postman)
-   [Contributing](#contributing)
-   [License](#license)
-   [Contact / Next steps](#contact--next-steps)

---

## Summary

This repository implements a PoC multi-tenant WhatsApp backend with:

-   Node.js + Express server
-   MongoDB (Mongoose) for persistence
-   Redis + BullMQ for job queueing and retries
-   Worker process for sending outbound messages
-   Per-tenant onboarding, template storage, flows, and send APIs
-   Webhook receiver that routes inbound events to the correct tenant using `metadata.phone_number_id`
-   Idempotency protections and duplicate detection

This README documents local development, APIs, security, and recommended production improvements.

---

## Features

-   Tenant registration (manual PoC or simulated tokens)
-   Template storage (per-tenant)
-   Flow rules (match inbound text → send template / set state)
-   Queued outbound sends, with retries and exponential backoff
-   Auto-reply for inbound messages (idempotent)
-   Webhook signature verification (HMAC-SHA256)
-   Simple encryption of tenant tokens using a `MASTER_KEY` (dev-only pattern)
-   **Interactive message templates with buttons (new):** send WhatsApp interactive-button templates, capture button replies, and branch conversation flows per-tenant.
-   **Multi-branch conversations:** configure next-step templates per button to form a decision tree / menu flow that is data-driven and tenant-specific.
-   **Conversation state tracking:** backend tracks last-sent template per customer to resolve button replies to the correct context.
-   **Analytics-friendly inbound button replies:** button clicks are stored as inbound Messages so you can run CSAT and other metrics queries.

-   **Per-tenant Template Builder UI:** Admin can select a tenant, define message text, choose whether it's plain text or interactive-button type, add up to 3 WhatsApp buttons, and wire each button to the "next template". No code changes needed to extend the conversation tree for that tenant.
-   **Backend-generated template keys:** When saving a new template from the UI, the backend generates a unique `key` for that template (namespaced per-tenant). The UI does not require the user to invent keys manually. The returned `key` is then used as `nextTemplateKey` for future buttons.

---

## Interactive templates & multi-branch conversations

This project now supports interactive WhatsApp templates that include tappable buttons. Each template can be configured per-tenant and each button may define the "nextTemplateKey" (and optional state), enabling tree-like branching flows without server code changes. Typical use cases:

-   Customer feedback (Good / OK / Bad) with different followups per answer
-   Multi-level menus (Main Menu → Balance → Statement → Date range)
-   Guided flows (collect account number → confirm → provide statement)

### Key runtime concepts

-   **Template kinds**: `text` or `interactive_button`. Interactive templates include `buttons[]` with stable `id` values that are returned by WhatsApp when users tap.
-   **ConversationState.lastTemplateKey**: stores which template was last sent to a customer. When a button reply arrives, the engine loads that template and finds the matching button by `id` to determine the `nextTemplateKey`.
-   **Payload handling**: webhook parses `interactive.button_reply.id` and `interactive.button_reply.title` and forwards `payloadId` to the conversation engine alongside any text body.
-   **Queue/worker**: outbound interactive messages are queued as jobs. The worker builds the WhatsApp `interactive` payload (body + action.buttons[].reply{id,title}) and sends via Meta Cloud API. Plain text messages remain unchanged.

---

## Admin Template Builder UI (per-tenant)

We ship a lightweight admin UI that lets us configure conversation flows for each tenant without code.

### What you can do in this UI

1. Select which tenant you are editing.
2. Create a new template:

    - Enter the message body text (for example: "How can we help you?").
    - Choose template kind:
        - `text`: plain outbound WhatsApp text.
        - `interactive_button`: WhatsApp interactive message with up to 3 reply buttons.
    - (If `interactive_button`) Add buttons:
        - Button label shown to the user in WhatsApp (e.g. "Check Balance").
        - Auto-generated payload `id` (read-only in the UI). This is what WhatsApp will send back on tap.
        - `nextTemplateKey`: which template to send next when this button is tapped.
        - (Optional) `nextState`: update the conversation state machine for this user.

3. Save the template.

### Auto-generated template keys

The UI does NOT ask you to type a template `key`.  
When you click "Save Template":

-   The backend will generate a stable unique key (e.g. `tmpl_ab12cd34`), store the template for that tenant, and return the saved template (including the key).
-   The UI will display that generated key in read-only form so you can reference it in other buttons’ `nextTemplateKey`.

## This means non-technical users can build menu trees (branching flows) just by clicking in the UI. They do not have to invent or manage unique template keys manually.

## Runtime user flow (how it will work)

Below is the step-by-step runtime user flow a real WhatsApp user experiences — and how the backend processes each event:

0. **Admin pre-configures templates for this tenant**

    - In the Template Builder UI, the admin creates:
        - A "menu" template (kind `interactive_button`) with buttons like "Check Balance", "Account Statement", etc.
        - Follow-up templates for each branch ("show_balance", "statement_flow", ...).
    - Each button in the menu points to the next template via `nextTemplateKey`.
    - When saved, the backend stores these templates for that specific tenant and returns each template's generated `key`.

1. **Trigger / first message**

    - Either user sends "hi" or your system pushes a `main_menu` template to the user.
    - Backend selects the `main_menu` template (interactive) and enqueues an outbound job.

2. **Outbound interactive message is sent**

    - Worker constructs an `interactive` payload, including `action.buttons` with `reply.id` and `reply.title` for each button and sends it to WhatsApp via tenant's access token.
    - Backend sets `ConversationState.lastTemplateKey = "main_menu"` for this tenant+user pair.

3. **User taps a button**

    - WhatsApp posts an event to your webhook that includes `interactive.button_reply.id` (the stable payload).
    - Webhook verifies signature, finds tenant by `metadata.phone_number_id`, creates inbound Message record, and calls the conversation engine with `payloadId` and `from` details.

4. **Engine resolves branch**

    - Engine loads ConversationState, reads `lastTemplateKey` (e.g., `main_menu`) and loads that template.
    - It finds the clicked button by `id` and reads its `nextTemplateKey` (e.g., `show_balance`).
    - Engine loads the `show_balance` template and returns either a text reply or another interactive-button reply. It updates `lastTemplateKey` accordingly and may set `state` if button defined `nextState`.

5. **Outbound next step**

    - Reply is queued and worker sends it. If `show_balance` is interactive, new buttons are included; otherwise a text is sent (e.g., "Your balance is ₹X").

6. **Repeat or finish**

    - The flow repeats as users tap new buttons, with each button mapping to another template or action. If no mapping is found, falls back to `fallbackTemplateKey` as configured in the Flow.

This is fully multi-tenant: the webhook maps inbound to the right tenant and all templates, flows, and states are stored per-tenant.

---

## Schema changes (what's new)

Additions suggested to Mongoose schemas to support interactive templates and state-based branching.

### Template schema (new fields)

```js
kind: { type: String, enum: ['text','interactive_button'], default: 'text' },
buttons: [{
  id: { type: String, required: true },       // stable payload id returned by WhatsApp
  title: { type: String, required: true },    // label shown to user
  nextTemplateKey: { type: String },          // template key to send next
  nextState: { type: String }                 // optional state transition
}]
```

Note on `key`:

-   Each template still has a `key` string internally (e.g. `tmpl_ab12cd34`).
-   In the UI, `key` is not typed by the admin. The backend will generate it on create.
-   Buttons reference other templates by `nextTemplateKey`, so a button can jump to any other template in the same tenant.

### ConversationState additions

```js
lastTemplateKey: { type: String }, // last template key sent to this customer
state: { type: String, default: "default" } // optional business state
```

Behavior notes:

-   When an interactive template is sent, `lastTemplateKey` must be set to the template key so subsequent button clicks can be resolved.
-   When a button is clicked, engine uses `lastTemplateKey + payloadId` to map to a `nextTemplateKey` and possibly update `state`.

---

## API & Webhook changes (what to update)

### Webhook parsing

-   Webhook must parse `interactive.button_reply.id` and `interactive.button_reply.title` in inbound payloads and persist the inbound message as `type: "button_reply"` (direction: IN). Provide the engine both `text` (title) and `payloadId` (id).

### Conversation engine API

-   Add a handler `handleInboundAdvanced({ tenantId, fromWaId, text?, payloadId? })` that:

    -   If `payloadId` present: resolves using `ConversationState.lastTemplateKey` → template.buttons → chosen button → `nextTemplateKey` → send that template.
    -   Else: fallback to existing flow rule processing (contains/regex/exact) → replyTemplateKey → send.

### Send job payload shape

-   Outbound job should include `content: { kind: "text"|"interactive_button", text: string, buttons?: [{id,title}] }` so worker can construct proper WhatsApp payloads.

### Backward compatibility

-   Keep existing text-only flows working (default `kind='text'`). New fields are additive. Existing templates without buttons continue to function unchanged.

### Admin-facing template save (UI → backend)

`POST /tenants/:tenantId/templates`

Body shape (from the UI):

````json
{
  "body": "How can we help you?",
  "kind": "interactive_button",
  "buttons": [
    {
      "id": "btn_x1y2z3",
      "title": "Check Balance",
      "nextTemplateKey": "tmpl_balance_menu"
    },
    {
      "id": "btn_a7b8c9",
      "title": "Account Statement",
      "nextTemplateKey": "tmpl_statement_menu"
    }
  ],
  "isActive": true,
  "description": "Main menu for banking tenant"
}


## Behavior:
- Server will auto-generate a unique key if not provided.
- Server persists the template for that tenant.
- Server returns the saved template JSON and the generated key.
- The UI shows the generated key read-only so admins can wire future buttons (nextTemplateKey) to this template.

---



## Prerequisites

-   Node.js (>=16 recommended) — if running locally
-   npm or yarn
-   Docker & Docker Compose (recommended for full stack dev)
-   Redis
-   MongoDB

You can run the full stack with Docker Compose (recommended) or run components locally. Examples below.

---

## Quickstart (Development)

1. Copy environment example:

```bash
cp .env.example .env
# Edit .env and fill in real values for dev (or keep dev defaults)
````

2. Install dependencies (if running locally):

```bash
# backend
cd server
npm install

# frontend (optional test UI)
cd ../frontend
npm install
```

3. Start dependencies (if not using docker-compose):

-   Start MongoDB and Redis (local or via docker).
-   Run the backend:

```bash
# from server/
npm run dev   # uses nodemon to restart on changes
```

4. Or start full stack with Docker Compose:

```bash
docker-compose up --build
```

Service endpoints (defaults):

-   Backend API: `http://localhost:3000`
-   Frontend dev (Vite): `http://localhost:5173` (if provided)
-   Mongo Express (optional): `http://localhost:8081`

---

## Environment variables / .env.example

Create `.env` from `.env.example`. Example content:

```text
# .env.example (DO NOT COMMIT REAL SECRETS)
APP_ENV=development
PORT=3000

# Mongo
MONGO_URI=mongodb://mongo:27017/pocdb

# Redis (BullMQ)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_URL=redis://redis:6379

# Security
APP_SECRET=your_meta_app_secret_here   # used to verify incoming webhook signatures
VERIFY_TOKEN=local_verify_token        # used for webhook verification challenge
MASTER_KEY=32_byte_random_string_here  # used to encrypt tenant access tokens (dev-only)

# App behavior
WHATSAPP_API_VERSION=v20.0
VITE_API_BASE=http://localhost:3000/api

# Optional
LOG_LEVEL=info
```

**Security note:** In production use a secrets manager (KMS) and do not store secrets in plaintext.

---

## Docker / Compose usage

Provide a `docker-compose.yml` at repo root that includes services:

-   `app` (backend)
-   `worker` (BullMQ worker)
-   `mongo`
-   `redis`
-   optional `mongo-express` and `frontend` (vite)

Example:

```bash
docker-compose up --build
# tail logs
docker-compose logs -f app
docker-compose logs -f worker
```

If you modify `package.json` deps, rebuild images:

```bash
docker-compose build app worker
```

---

## Project layout

(Adjust to your actual project paths)

```
.
├─ docker-compose.yml
├─ Dockerfile.dev
├─ .env.example
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ index.js          # app entry
│  │  ├─ app.js            # express and routing
│  │  ├─ db.js             # mongoose connection (with retry)
│  │  ├─ models/           # mongoose models (Tenant, Customer, Message, Flow, Template)
│  │  ├─ controllers/      # route handlers
│  │  ├─ services/         # send, tenant service, flow engine
│  │  ├─ workers/          # bullmq workers
│  │  └─ middlewares/      # raw body capture, auth, error handler
├─ frontend/                # optional react/vite test UI
└─ docs/
   ├─ openapi.yaml
   └─ diagrams/
```

---

## API Reference (curl examples)

Base URL (dev): `http://localhost:3000/api`
(If your server does not mount at `/api`, use root `http://localhost:3000`)

> NOTE: This section shows representative endpoints. Replace `:tenantId` with the actual tenant `_id` from DB.

### Health

```bash
GET /health
# Response
{ "ok": true }
```

### Register Tenant (PoC)

Registers a tenant and stores encrypted access token (dev PoC).

```bash
POST /tenants/register
Content-Type: application/json

Body:
{
  "name": "Tenant A",
  "phoneNumberId": "111111111111111",
  "accessToken": "mock_token_tenant_A"
}
```

Response: `201 Created` with tenant JSON.

### Templates

Create template (per tenant):

```bash
POST /tenants/:tenantId/templates
Authorization: Bearer <MASTER_KEY>
Content-Type: application/json

Body:
{
  "key": "welcome_v1",
  "language": "en",
  "components": [
    { "type": "body", "text": "Hello {{first_name}}, welcome!" }
  ],
  "metadata": { "description": "Welcome template" }
}
```

Get templates:

```bash
GET /tenants/:tenantId/templates
```

Notes: `key` must be unique per tenant. API returns `201` on create.

### Flows

Save or update flow rules for a tenant:

```bash
POST /tenants/:tenantId/flows
Authorization: Bearer <MASTER_KEY>
Content-Type: application/json

Body:
{
  "flows": [
    {
      "id": "greeting_flow",
      "match": { "type": "contains", "values": ["hello","hi"] },
      "action": { "type": "send_template", "templateKey": "welcome_v1" }
    }
  ],
  "fallbackTemplateKey": "fallback_v1"
}
```

GET flows:

```bash
GET /tenants/:tenantId/flows
```

Document the flow schema in `docs/flow-schema.md` (recommended): types supported (`contains`, `regex`, `exact`, boolean composition), limits and evaluation order.

### Send Message (raw & template)

**Send raw text (custom payload):**

```bash
POST /tenants/:tenantId/send
Authorization: Bearer <MASTER_KEY>
Content-Type: application/json

Body:
{
  "to": "+15551234567",
  "text": "Hello Sam",
  "idempotency_key": "send:order:12345"
}
```

**Send using stored template:**

```bash
POST /tenants/:tenantId/send/template
Authorization: Bearer <MASTER_KEY>
Content-Type: application/json

Body:
{
  "to": "+15551234567",
  "templateKey": "welcome_v1",
  "variables": { "first_name": "Sam" },
  "idempotency_key": "send:order:12345"
}
```

Responses:

-   `202 Accepted` when queued, or `201 Created` with message object depending on implementation.
-   `409 Conflict` if idempotency key exists.

### Webhook (verify & events)

**Verify endpoint (GET)**

Meta verification:

```bash
GET /whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=<challenge>
```

Return `hub.challenge` when `hub.verify_token` matches `VERIFY_TOKEN`.

**Receive events (POST)**

```bash
POST /whatsapp/webhook
Headers:
  X-Hub-Signature-256: sha256=<hex>  # if APP_SECRET set
Body: JSON with 'entry' / 'changes' from Meta
```

Behavior:

-   Parse `metadata.phone_number_id` → find tenant with matching `phoneNumberId`
-   Persist inbound `Message` (direction: IN)
-   Upsert `Customer` by `from` (wa id)
-   Evaluate `flows` for tenant; enqueue outbound action(s)
-   Enqueue an auto-reply (idempotent) if configured

---

## Webhook signature verification (security)

Always verify incoming webhooks using HMAC-SHA256 computed over the **exact raw request body** with `APP_SECRET`.

**OpenSSL example:**

```bash
echo -n '<raw-body-json>' | openssl dgst -sha256 -hmac "$APP_SECRET"
# The result will be like: (stdin)= <hex>
# Header value expected: sha256=<hex>
```

**Node (Express) example:**

```js
// Use express.raw to capture the exact bytes before JSON parsing:
app.post("/whatsapp/webhook", express.raw({ type: "*/*" }), (req, res) => {
    const signatureHeader = req.get("X-Hub-Signature-256") || "";
    const raw = req.body; // Buffer
    const expected = "sha256=" + crypto.createHmac("sha256", process.env.APP_SECRET).update(raw).digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) {
        return res.status(401).send("Invalid signature");
    }

    // Now parse JSON safely:
    const parsed = JSON.parse(raw.toString("utf8"));
    // ... handle event
});
```

**Important:** Use `express.raw` or an equivalent to get the **raw bytes**. Do not use `express.json()` before verifying.

---

## Data model (conceptual)

**Tenant**

-   `_id`, `name`, `phoneNumberId` (unique), `wabaId`, `accessTokenEnc`, `status`, `createdAt`, `updatedAt`

**Customer**

-   `_id`, `tenantId`, `waId` (E.164), `name`, `lastSeenAt`, `metadata`

**Message**

-   `_id`, `tenantId`, `conversationId?`, `direction` (`IN` | `OUT`), `waMessageId`, `body`, `idempotencyKey`, `type` (`text`|`button_reply`|`interactive_button`), `status` (`queued|sending|sent|delivered|read|failed`), `attempts`, timestamps

**Template**

-   `_id`, `tenantId`, `key`, `language`, `kind` (`text`|`interactive_button`), `body`, `buttons`, `metadata`, `version`, timestamps

**Flow**

-   `_id`, `tenantId`, `id`, `rules[]`, `fallbackTemplateKey`, timestamps

Add full Mongoose schemas in `server/src/models/` and document indexes (e.g., unique index on `(tenantId, idempotencyKey)`).

---

## Queueing, retries & idempotency

-   **Queue:** BullMQ queue (`whatsapp-send-queue`) processes outbound send jobs.
-   **Retry strategy:** configurable attempts (e.g., 5) with exponential backoff.
-   **Idempotency:** store `idempotencyKey` per-tenant in messages collection; create unique partial index:

    ```js
    db.messages.createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });
    ```

-   **Auto-replies:** use deterministic idempotency key `auto-reply:<inbound-wa-message-id>` to avoid duplicates.
-   **Worker safety:** worker must check message status before attempting send and use transactions / upserts when possible to mark job processed.
-   **Outbound job shape example:**

```json
{
    "tenantId": "xxx",
    "messageId": "yyy",
    "to": "+91...",
    "content": {
        "kind": "interactive_button",
        "text": "How can we help you?",
        "buttons": [
            { "id": "acc_balance", "title": "Check Balance" },
            { "id": "acc_stmt", "title": "Account Statement" }
        ]
    },
    "idempotencyKey": "auto-reply:in-xxxx"
}
```

---

## Errors & status codes

Common API responses:

-   `200 OK` — successful GET or idempotent update
-   `201 Created` — resource created
-   `202 Accepted` — request accepted and enqueued
-   `400 Bad Request` — validation error / missing fields
-   `401 Unauthorized` — invalid / missing auth token
-   `403 Forbidden` — insufficient permissions
-   `404 Not Found` — resource does not exist
-   `409 Conflict` — duplicate (e.g., unique index violation or idempotency collision)
-   `422 Unprocessable Entity` — semantic errors (optional)
-   `500 Internal Server Error` — unexpected errors

Return JSON error bodies with `error` and `message` fields for clients to parse.

Example 409:

```json
{
    "error": "Conflict",
    "message": "Request with the given idempotency_key already processed"
}
```

---

## Testing & local development tips

-   Unit tests: Jest / Vitest for services and controllers
-   Integration tests: supertest + in-memory MongoDB (mongodb-memory-server) and a mocked BullMQ/Redis
-   Linting: ESLint + Prettier
-   Example commands (add these to `package.json` scripts):

```json
{
    "scripts": {
        "dev": "nodemon --watch src --exec \"node -r dotenv/config src/index.js\"",
        "start": "node src/index.js",
        "test": "jest --runInBand",
        "lint": "eslint src --fix"
    }
}
```

-   For quick integration tests, run Mongo in Docker and point `MONGO_URI` to it, or use `mongodb-memory-server`.

---

## Observability & troubleshooting

-   Expose health endpoint `/health` and worker stats
-   Logs: structured JSON logs (pino/winston) and centralize in ELK/Datadog
-   Metrics: instrument with Prometheus counters for jobs, retries, errors
-   Alerts: on worker error spikes, zombie jobs, high retry rates, or failing webhook signature verifications

Common troubleshooting tips:

-   `401` on webhook → signature verification mismatch; ensure raw body capture and correct `APP_SECRET`
-   Duplicate sends → missing idempotency key or incorrect index; check DB unique index
-   Queue not processing → worker not connected to Redis, or connection config wrong

---

## Production considerations

-   Use Cloud KMS (AWS KMS / GCP KMS / Azure Key Vault) for access token encryption and rotation
-   Replace simulated `mock_` tokens with Meta Embedded Signup / OAuth flow for real onboarding
-   Harden auth: use proper JWTs or mTLS for inter-service auth
-   Run worker processes separately and autoscale based on queue depth
-   Implement per-tenant rate limiting and throttling
-   Add DLQ (dead-letter queue) for permanently failing jobs, with alerting and manual retry flow
-   Harden schema validation and add API contract tests (contract tests)
-   Use TLS, private networks, and least privilege IAM

---

## OpenAPI / Postman

-   Provide an `openapi.yaml` (skeleton) in `docs/` describing main endpoints:

    -   `POST /tenants/register`
    -   `POST /tenants/{tenantId}/templates`
    -   `POST /tenants/{tenantId}/flows`
    -   `POST /tenants/{tenantId}/send`
    -   `POST /whatsapp/webhook`

-   Export Postman collection for QA and integrators.

If you want, I can generate a minimal OpenAPI skeleton and a Postman collection for import.

---

## Contributing

Create `CONTRIBUTING.md` covering:

-   Repo layout and conventions
-   Branching model: `main` protected; feature branches `feat/<desc>`
-   Commit message style (Conventional Commits recommended)
-   PR checklist:

    -   Lint pass
    -   Unit tests added/updated
    -   Integration tests if applicable
    -   Documentation updated (README / API examples)

-   How to run tests locally

---

## License

Add `LICENSE` file (e.g., MIT or another appropriate license). The repo currently does not include a license — choose one and add it.

---

## Contact / Next steps

If you'd like I can:

-   Produce `openapi.yaml` and Postman collection
-   Create `.env.example` file and `Dockerfile.dev` / `docker-compose.yml` examples
-   Generate `git diff` or patch files for README updates
-   Add basic Jest unit tests and a CI workflow (GitHub Actions)
-   Generate a simple admin UI mockup for creating interactive templates/adding buttons

Reply with which next step(s) you want me to produce and I will generate the files/patches accordingly.

---

## Run ESLint fixes inside Docker

Use the following commands to run the project's linting (and autofix) inside the project's containers:

```bash
# run as a one-off container (build images first if needed)
docker compose run --rm app npm run lint:fix:all

# run inside a running app service (start services first)
docker compose exec app sh -c "npm run lint:fix:all"

# run using docker exec against a running container named `poc_app`
docker exec -it poc_app sh -c "npm run lint:fix:all"
```

**Notes / best practices**

-   These commands use Docker Compose v2 (`docker compose`). If your system only has the legacy CLI, replace `docker compose` with `docker-compose`.
-   `eslint --fix` will modify files on the host because the repo is mounted into the container. Always create a branch or stash changes before running autofix so you can review fixes in version control.
-   Ensure dependencies are installed in the image (or run `npm ci` inside the container) before running lint. Consider adding a lightweight `lint` image/target in CI to keep environments consistent.
-   If you want to avoid linting config files (like `eslint.config.cjs`), add them to `.eslintignore` or adjust your lint script to limit its scope (e.g. `eslint src --ext .ts --fix`).

---
