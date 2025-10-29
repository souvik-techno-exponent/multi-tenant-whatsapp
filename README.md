# WhatsApp Multi-Tenant Backend (Node.js + MongoDB + Redis + BullMQ)

> Development-friendly proof-of-concept for a multi-tenant WhatsApp messaging backend.
> Each tenant connects their own WhatsApp \`phone_number_id\` via Meta Cloud API (or simulated tokens in dev),
> incoming messages are routed to the correct tenant, and outbound messages are queued with retries
> and idempotency guarantees.

---

## Table of Contents

-   [Summary](#summary)
-   [Features](#features)
-   [Interactive templates & multi-branch conversations](#interactive-templates--multi-branch-conversations)
-   [Admin Template Builder UI (per-tenant)](#admin-template-builder-ui-per-tenant)
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
-   [Run ESLint fixes inside Docker](#run-eslint-fixes-inside-docker)

---

## Summary

This repository implements a PoC multi-tenant WhatsApp backend with:

-   Node.js + Express server
-   MongoDB (Mongoose) for persistence
-   Redis + BullMQ for job queueing and retries
-   Worker process for sending outbound messages
-   Per-tenant onboarding, template storage, flows, and send APIs
-   Webhook receiver that routes inbound events to the correct tenant using \`metadata.phone_number_id\`
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
-   Simple encryption of tenant tokens using a \`MASTER_KEY\` (dev-only pattern)
-   **Interactive message templates with buttons (new):** send WhatsApp interactive-button templates, capture button replies, and branch conversation flows per-tenant.
-   **Multi-branch conversations:** configure next-step templates per button to form a decision tree / menu flow that is data-driven and tenant-specific.
-   **Conversation state tracking:** backend tracks last-sent template per customer to resolve button replies to the correct context.
-   **Analytics-friendly inbound button replies:** button clicks are stored as inbound Messages so you can run CSAT and other metrics queries.
-   **Per-tenant Template Builder UI:** Admin can select a tenant, define message text, choose whether it's plain text or interactive-button type, add up to 3 WhatsApp buttons, and wire each button to the "next template". No code changes needed to extend the conversation tree for that tenant.
-   **Backend-generated template keys:** When saving a new template from the UI, the backend generates a unique \`key\` for that template (namespaced per-tenant). The UI does not require the user to invent keys manually. The returned \`key\` is then used as \`nextTemplateKey\` for future buttons.

---

## Interactive templates & multi-branch conversations

This project supports interactive WhatsApp templates that include tappable quick-reply buttons. Each template can be configured per tenant, and each button may define the \`nextTemplateKey\` (and optional \`nextState\`), enabling tree-like branching flows without server code changes.

Typical use cases:

-   Customer feedback (Good / OK / Bad) with different followups per answer
-   Multi-level menus (Main Menu → Balance → Statement → Date range)
-   Guided flows (collect account number → confirm → provide statement)

### Key runtime concepts

-   **Template kinds**: \`text\` or \`interactive_button\`.
    -   \`interactive_button\` templates include a \`buttons[]\` array, where each button has:
        -   a machine-stable \`id\` that WhatsApp will send back when clicked,
        -   a human-visible \`title\`,
        -   and \`nextTemplateKey\` (what to send next).
-   **ConversationState.lastTemplateKey**: stores which template was last sent to a customer. When a button reply arrives, the engine loads that template and finds the matching button by \`id\` to determine the \`nextTemplateKey\`.
-   **Payload handling**: the webhook parses \`interactive.button_reply.id\` (payload) and \`interactive.button_reply.title\` (button title the user tapped). It forwards \`payloadId\` plus optional text to the conversation engine.
-   **Queue/worker**: outbound interactive messages are queued as jobs. The worker builds the WhatsApp \`interactive\` payload (body + \`action.buttons[].reply\`) and sends via Meta Cloud API. Plain text messages remain \`type: "text"\`.

### Limitations / current assumptions

-   WhatsApp reply buttons typically allow up to **3** quick-reply buttons per message.
-   We branch only on:
    -   button taps (using the payload \`id\`), or
    -   text-match rules in the flow (contains/regex/etc.).
        No NLP/LLM intent routing is included.
-   Branching is per tenant. Tenant A’s templates/flow/state are isolated from Tenant B.
-   Worker must support sending \`type: "interactive"\` payloads for interactive templates. For \`kind="text"\`, we fall back to plain WhatsApp text sends.

---

## Admin Template Builder UI (per-tenant)

We ship a lightweight admin UI that lets us configure conversation flows for each tenant without changing server code.

### What you can do in this UI

1. Select which tenant you are editing.
2. Create a new template:
    - Enter the message body text (for example: \`"How can we help you?"\`).
    - Choose template kind:
        - \`text\`: plain outbound WhatsApp text.
        - \`interactive_button\`: WhatsApp interactive message with up to 3 reply buttons.
    - If \`interactive_button\`, add buttons:
        - **Title**: label shown to the user in WhatsApp (e.g. "Check Balance").
        - **Payload \`id\`**: auto-generated in the UI (read-only). This is what WhatsApp will send back when the user taps that button.
        - **nextTemplateKey**: which template to send next when this button is tapped.
        - **nextState** (optional): update the conversation state machine for this user.
3. Save the template.

### Auto-generated template keys

The UI does **not** ask you to type a template \`key\`.

When you click "Save Template":

-   The backend generates a stable unique key (e.g. \`tmpl_ab12cd34\`), stores the template for that tenant, and returns the saved template (including the key).
-   The UI then displays that generated \`key\` read-only so admins can reference it when wiring future buttons' \`nextTemplateKey\`.

That means non-technical admins can build branching menu trees just by clicking in the UI. They do not have to invent or manage unique keys manually.

### UI validation & limits

-   Limit buttons to max **3** per template (WhatsApp quick-reply restriction).
-   Enforce reasonable button title length (e.g. ≤ 24 chars) to avoid truncation in the WhatsApp client.
-   Button \`id\` is auto-generated (e.g. \`btn\_<rand>\`) and should not be hand-edited unless you explicitly support custom payloads.
-   \`nextTemplateKey\` should be chosen from templates that belong to the **same tenant**.
-   Server-side validation should enforce:
    -   \`kind ∈ {"text","interactive_button"}\`
    -   If \`kind === "interactive_button"\`, \`buttons.length ∈ [1,3]\`, and each button has both \`id\` and \`title\`.

> Security note: Admin routes should be protected (e.g. \`Authorization: Bearer <MASTER_KEY>\` in dev, or real auth in prod). \`MASTER_KEY\` is dev-only. In production, use proper auth + KMS-backed secrets storage.

---

## Runtime user flow (how it will work)

This is the end-to-end flow for a real WhatsApp conversation, and how the backend processes each step.

### 0. Admin pre-configures templates for this tenant

-   In the Template Builder UI, the admin creates:
    -   A "menu" template (kind \`interactive_button\`) with buttons like "Check Balance", "Account Statement", etc.
    -   Follow-up templates for each branch (\`show_balance\`, \`statement_flow\`, ...).
-   Each button in the menu points to the next template via \`nextTemplateKey\`.
-   On save, the backend stores these templates for that tenant and returns each template's generated \`key\`.

### 1. Trigger / first message

-   Either the end user sends "hi" / "help", or the system proactively sends a \`main_menu\` template to that user.
-   Backend selects the relevant template (e.g. \`main_menu\`) and enqueues an outbound job.

### 2. Outbound interactive message is sent

-   The worker constructs a WhatsApp \`interactive\` payload including:
    -   \`body.text\` (the question)
    -   \`action.buttons[].reply.id\` and \`action.buttons[].reply.title\` for each button.
-   The worker sends using the tenant's access token.
-   Backend sets \`ConversationState.lastTemplateKey = "main_menu"\` for this (tenantId, userWaId) pair.

### 3. User taps a button

-   WhatsApp hits \`/whatsapp/webhook\` with an event that includes \`interactive.button_reply.id\` (the stable payload for the tapped button).
-   Webhook:
    -   Verifies signature,
    -   Resolves which tenant using \`metadata.phone_number_id\`,
    -   Logs an inbound Message with \`type: "button_reply"\`,
    -   Calls the conversation engine with \`payloadId\` and the user's WhatsApp number.

### 4. Engine resolves branch

-   Engine loads \`ConversationState\`, reads \`lastTemplateKey\` (e.g. \`"main_menu"\`), and fetches that template.
-   It finds the clicked button by \`id\`, reads its \`nextTemplateKey\`, and loads that next template.
-   It returns either:
    -   a plain text reply, or
    -   another interactive-button template (with new buttons).
-   It updates \`lastTemplateKey\` to the new template key and, if defined, updates \`state\` via the button's \`nextState\`.

### 5. Outbound next step

-   The reply from step 4 is enqueued.
-   The worker sends it to WhatsApp.
-   If the next template is interactive, the user now sees a new button menu.  
    If it's text, they just see an answer (e.g. "Your balance is ₹X").

### 6. Repeat or finish

-   The conversation loops: user taps → webhook → engine → queue → worker → WhatsApp.
-   If no mapping is found for a tap or free-text message, the system falls back to \`fallbackTemplateKey\` from that tenant's Flow config.

**Multi-tenant isolation:**  
All of the above runs per tenant. The webhook uses \`metadata.phone_number_id\` to find the tenant, and state/templates/flows are always stored under that tenant's ID.

---

## Schema changes (what's new)

These additions extend the data model to support interactive templates, button routing, and per-user state.

### Template schema (new fields)

```js
kind: {
  type: String,
  enum: ["text", "interactive_button"],
  default: "text"
},
buttons: [
  {
    id: { type: String, required: true },        // stable payload id returned by WhatsApp
    title: { type: String, required: true },     // label shown to the end user
    nextTemplateKey: { type: String },           // template key to send next
    nextState: { type: String }                  // optional state transition
  }
]
```

**Note on `key`:**

-   Each template still has a `key` (ex: `tmpl_ab12cd34`).
-   In the UI, admins do **not** type `key`. The backend generates it on create.
-   Buttons reference other templates by `nextTemplateKey`, so a button can jump to any other template belonging to the **same tenant**.

### ConversationState additions

```js
lastTemplateKey: { type: String },             // last template key sent to this customer
state: { type: String, default: "default" }    // optional business state
```

**Behavior notes:**

-   Whenever you send an interactive template, set `lastTemplateKey` to that template so future button taps can be resolved.
-   On a button tap, the engine uses `lastTemplateKey + payloadId` to figure out which branch to follow next (`nextTemplateKey`) and (optionally) update `state`.

### Migration note

If you already have templates in Mongo:

-   Set `kind = "text"` where missing.
-   Set `buttons = []` where missing.
-   Ensure unique indexes exist:
    -   `db.templates.createIndex({ tenantId: 1, key: 1 }, { unique: true })`
    -   `db.messages.createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } })`

This preserves backward compatibility and adds interactive branching safely.

---

## API & Webhook changes (what to update)

### Webhook parsing

-   The webhook must extract button replies from WhatsApp:
    -   `interactive.button_reply.id` → `payloadId`
    -   `interactive.button_reply.title` → human-readable text (optional)
-   Store inbound button clicks as Messages with:
    -   `direction: "IN"`
    -   `type: "button_reply"`
    -   `body`: either the button title or the payload id
-   Pass both `payloadId` and `text` (if any) to the conversation engine.

#### Example inbound webhook (button reply)

When a user taps a reply button, Meta Cloud typically sends an `interactive` message. Simplified example:

```json
{
    "entry": [
        {
            "changes": [
                {
                    "value": {
                        "messages": [
                            {
                                "from": "919999999999",
                                "id": "wamsg_123",
                                "timestamp": "1698620000",
                                "type": "interactive",
                                "interactive": {
                                    "type": "button_reply",
                                    "button_reply": {
                                        "id": "btn_x1y2z3",
                                        "title": "Check Balance"
                                    }
                                }
                            }
                        ],
                        "metadata": {
                            "phone_number_id": "111111111111111"
                        }
                    }
                }
            ]
        }
    ]
}
```

The webhook:

1. Uses `metadata.phone_number_id` to resolve which tenant this belongs to.
2. Logs the inbound message in Mongo.
3. Calls the conversation engine with `tenantId`, `fromWaId`, and `payloadId = "btn_x1y2z3"`.

### Conversation engine API

Add / extend a handler like:

```ts
handleInboundAdvanced({
    tenantId,
    fromWaId,
    text, // free text or button title
    payloadId, // button_reply.id
});
```

Engine behavior:

1. If `payloadId` is present:
    - Load `ConversationState` for (tenantId, fromWaId).
    - Look up `lastTemplateKey`.
    - Load that template, find the button whose `id === payloadId`.
    - Read that button's `nextTemplateKey`.
    - Load that next template and generate the reply (text or interactive).
    - Update `ConversationState.lastTemplateKey` (and `state` if `nextState` is defined).
2. Otherwise:
    - Run existing flow rules (contains / equals / regex).
    - Resolve `replyTemplateKey`.
    - Send that template and update `ConversationState.lastTemplateKey`.

### Send job payload shape

Outbound jobs added to BullMQ should now include enough info for the worker to decide whether to send plain text or interactive buttons:

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

-   If `content.kind === "interactive_button"`, the worker sends a WhatsApp `type: "interactive"` payload.
-   If `content.kind === "text"`, the worker sends the classic WhatsApp `type: "text"` payload.

### Backward compatibility

-   Existing text-only templates still work: they get `kind: "text"` and `buttons: []`.
-   \`handleInboundAdvanced\` falls back to the old rule-matching logic when no button payload is present.
-   The worker still knows how to send plain text (no change required other than branching on `content.kind`).

### Admin-facing template save (UI → backend)

`POST /tenants/:tenantId/templates`

Request (example payload from the admin UI):

```json
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
```

**Behavior**

-   Server auto-generates a unique `key` if not provided (e.g. `tmpl_ab12cd34`).
-   Server persists the template for that tenant and returns the saved template JSON (including the generated `key`).
-   The UI should display the generated `key` read-only so admins can wire future buttons (`nextTemplateKey`) to this template.

---

## Prerequisites

-   Node.js (>=16 recommended) — if running locally
-   npm or yarn
-   Docker & Docker Compose (recommended for full stack dev)
-   Redis
-   MongoDB

You can run the full stack with Docker Compose (recommended) or run components locally.

---

## Quickstart (Development)

1. Copy environment example:

```bash
cp .env.example .env
# Edit .env and fill in real values for dev (or keep dev defaults)
```

2. Install dependencies (if running locally):

```bash
# backend
cd server
npm install

# frontend (optional admin UI for templates)
cd ../frontend
npm install
```

3. Start dependencies (if not using docker-compose):

-   Start MongoDB and Redis (local or via docker).
-   Run the backend:

```bash
# from server/
npm run dev   # nodemon / ts-node style auto-reload
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

**Security note:** In production use a secrets manager (KMS) and do not store secrets in plaintext. \`MASTER_KEY\` is only acceptable for local dev / PoC.

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

```text
.
├─ docker-compose.yml
├─ Dockerfile.dev
├─ .env.example
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ index.js           # app entry
│  │  ├─ app.js             # express and routing
│  │  ├─ db.js              # mongoose connection (with retry)
│  │  ├─ models/            # mongoose models (Tenant, Customer, Message, Flow, Template)
│  │  ├─ controllers/       # route handlers
│  │  ├─ services/          # send, tenant service, flow engine
│  │  ├─ workers/           # bullmq workers
│  │  └─ middlewares/       # raw body capture, auth, error handler
├─ frontend/                # optional react/vite admin UI
└─ docs/
   ├─ openapi.yaml
   └─ diagrams/
```

---

## API Reference (curl examples)

Base URL (dev): `http://localhost:3000`  
(If you mount the API under `/api`, prepend that path.)

> NOTE: Replace `:tenantId` with the actual tenant `_id` from Mongo.

### Health

```bash
curl http://localhost:3000/health
# Response:
# { "ok": true }
```

### Register Tenant (PoC)

Registers a tenant and stores encrypted access token (PoC / dev flow).

```bash
curl -X POST http://localhost:3000/tenants/register   -H "Content-Type: application/json"   -d '{
    "name": "Tenant A",
    "phoneNumberId": "111111111111111",
    "accessToken": "mock_token_tenant_A"
  }'
```

Response: `201 Created` with tenant JSON.

### Create template for a tenant (admin UI flow)

```bash
curl -X POST "http://localhost:3000/tenants/:tenantId/templates"   -H "Authorization: Bearer ${MASTER_KEY}"   -H "Content-Type: application/json"   -d '{
    "body": "How can we help you?",
    "kind": "interactive_button",
    "buttons":[
      {"id":"btn_a1","title":"Check Balance","nextTemplateKey":"tmpl_balance_menu"},
      {"id":"btn_b2","title":"Account Statement","nextTemplateKey":"tmpl_statement_menu"}
    ],
    "isActive": true,
    "description": "Main menu for banking tenant"
  }'
```

Server will respond with something like:

```json
{
    "ok": true,
    "template": {
        "_id": "650a7b2e....",
        "tenantId": "60d1b2c3...",
        "key": "tmpl_8f3b2a1c",
        "kind": "interactive_button",
        "body": "How can we help you?",
        "buttons": [
            { "id": "btn_a1", "title": "Check Balance", "nextTemplateKey": "tmpl_balance_menu" },
            { "id": "btn_b2", "title": "Account Statement", "nextTemplateKey": "tmpl_statement_menu" }
        ],
        "isActive": true,
        "version": 1
    }
}
```

### Get templates for a tenant

```bash
curl "http://localhost:3000/tenants/:tenantId/templates"   -H "Authorization: Bearer ${MASTER_KEY}"
```

### Flows

Save or update flow rules for a tenant:

```bash
curl -X POST "http://localhost:3000/tenants/:tenantId/flows"   -H "Authorization: Bearer ${MASTER_KEY}"   -H "Content-Type: application/json"   -d '{
    "flows": [
      {
        "id": "greeting_flow",
        "match": { "type": "contains", "values": ["hello","hi"] },
        "action": { "type": "send_template", "templateKey": "tmpl_8f3b2a1c" }
      }
    ],
    "fallbackTemplateKey": "tmpl_fallback"
  }'
```

### Send message (raw text)

```bash
curl -X POST "http://localhost:3000/tenants/:tenantId/send"   -H "Authorization: Bearer ${MASTER_KEY}"   -H "Content-Type: application/json"   -d '{
    "to": "+15551234567",
    "text": "Hello Sam",
    "idempotency_key": "send:order:12345"
  }'
```

### Send message (by template)

```bash
curl -X POST "http://localhost:3000/tenants/:tenantId/send/template"   -H "Authorization: Bearer ${MASTER_KEY}"   -H "Content-Type: application/json"   -d '{
    "to": "+15551234567",
    "templateKey": "tmpl_8f3b2a1c",
    "variables": { "first_name": "Sam" },
    "idempotency_key": "send:order:12345"
  }'
```

Responses:

-   `202 Accepted` when queued, OR `201 Created` with message object (implementation detail).
-   `409 Conflict` if \`idempotency_key\` already used for this tenant.

---

## Webhook signature verification (security)

Always verify incoming webhooks using HMAC-SHA256 computed over the **exact raw request body** with \`APP_SECRET\`.

### OpenSSL example

```bash
echo -n '<raw-body-json>' | openssl dgst -sha256 -hmac "$APP_SECRET"
# Result will be like:
# (stdin)= <hex>
# Expected header: X-Hub-Signature-256: sha256=<hex>
```

### Node / Express example

```js
// Use express.raw(...) to capture the exact bytes before JSON parsing:
app.post("/whatsapp/webhook", express.raw({ type: "*/*" }), (req, res) => {
    const signatureHeader = req.get("X-Hub-Signature-256") || "";
    const raw = req.body; // Buffer

    const expected = "sha256=" + crypto.createHmac("sha256", process.env.APP_SECRET).update(raw).digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) {
        return res.status(401).send("Invalid signature");
    }

    // Safe to parse now:
    const parsed = JSON.parse(raw.toString("utf8"));
    // ... handle event (tenant routing, etc.)
});
```

**Important:** Do not run \`express.json()\` before signature verification. You must compare HMACs against the raw bytes.

---

## Data model (conceptual)

**Tenant**

-   \`\_id\`, \`name\`, \`phoneNumberId\` (unique), \`wabaId\`, \`accessTokenEnc\`, \`status\`, \`createdAt\`, \`updatedAt\`

**Customer**

-   \`\_id\`, \`tenantId\`, \`waId\` (E.164), \`name\`, \`lastSeenAt\`, \`metadata\`

**Message**

-   \`\_id\`, \`tenantId\`, \`conversationId?\`, \`direction\` (\`IN\` | \`OUT\`),
-   \`waMessageId\`, \`body\`, \`idempotencyKey\`,
-   \`type\` (\`text\` | \`button_reply\` | \`interactive_button\`),
-   \`status\` (\`queued|sending|sent|delivered|read|failed\`),
-   \`attempts\`, timestamps

**Template**

-   \`\_id\`, \`tenantId\`, \`key\`,
-   \`kind\` (\`text\` | \`interactive_button\`),
-   \`body\`, \`buttons\`,
-   \`isActive\`, \`version\`, timestamps

**Flow**

-   \`\_id\`, \`tenantId\`, \`id\`, \`rules[]\`, \`fallbackTemplateKey\`, timestamps

Add full Mongoose schemas in \`server/src/models/\` and document indexes (e.g., unique on \`(tenantId, key)\`, unique partial index on \`(tenantId, idempotencyKey)\`).

---

## Queueing, retries & idempotency

-   **Queue:** BullMQ queue (e.g. \`whatsapp-send-queue\`) processes outbound send jobs.
-   **Retry strategy:** configurable attempts (e.g. 5) with exponential backoff.
-   **Idempotency:** store \`idempotencyKey\` per-tenant in messages collection; use a unique partial index:

    ```js
    db.messages.createIndex(
        { tenantId: 1, idempotencyKey: 1 },
        {
            unique: true,
            partialFilterExpression: { idempotencyKey: { $exists: true } },
        }
    );
    ```

-   **Auto-replies:** use deterministic idempotency keys like \`auto-reply:<inbound-wa-message-id>\` to avoid duplicate sends.
-   **Worker safety:** worker should check message status before attempting send, and update status transactionally.
-   **Outbound job shape example:** (interactive buttons)

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
-   `422 Unprocessable Entity` — semantic validation error
-   `500 Internal Server Error` — unexpected server error

Error body example (409):

```json
{
    "error": "Conflict",
    "message": "Request with the given idempotency_key already processed"
}
```

---

## Testing & local development tips

-   Unit tests: Jest / Vitest for services, controllers, and the conversation engine.
-   Integration tests: supertest + in-memory MongoDB (mongodb-memory-server) and mocked BullMQ/Redis.
-   Linting: ESLint + Prettier.

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "nodemon --watch src --exec "node -r dotenv/config src/index.js"",
    "start": "node src/index.js",
    "test": "jest --runInBand",
    "lint": "eslint src --fix"
  }
}
```

For integration tests:

-   Run Mongo in Docker and point `MONGO_URI` to it,
    OR use `mongodb-memory-server` for throwaway DBs during tests.

Also consider adding a test that:

-   posts `/tenants/:tenantId/templates` with 4+ buttons and expects HTTP 422,
-   posts a duplicate `idempotency_key` and expects HTTP 409.

---

## Observability & troubleshooting

-   Expose a health endpoint `/health` for liveness probes.
-   Log in structured JSON (pino / winston) and centralize in ELK / Datadog.
-   Metrics:
    -   Prometheus counters for queue depth, retries, failed sends, webhook errors.
    -   Alert on worker error spikes / zombie jobs / invalid signature attempts.
-   Common issues:
    -   `401` on webhook → signature verification mismatch. Check `APP_SECRET` and raw body handling.
    -   Duplicate sends → missing or reused `idempotency_key`. Check Mongo unique index.
    -   Queue not processing → worker can't reach Redis, or worker container not running.

---

## Production considerations

-   Use a KMS (AWS KMS / GCP KMS / Azure Key Vault) to encrypt tenant access tokens and rotate them.
-   Replace simulated `mock_` tokens with Meta Embedded Signup / OAuth for true onboarding.
-   Harden auth:
    -   Replace dev-only `MASTER_KEY` with proper auth (JWT / session / RBAC).
    -   Restrict access to tenant admin endpoints.
-   Run worker processes separately and autoscale based on queue depth.
-   Add a DLQ (dead-letter queue) for permanently failing jobs, with alerting + manual retry UI.
-   Harden schema validation with runtime validators (zod / joi) and contract tests.
-   Use TLS, private networks, and least-privilege IAM. Treat \`phone_number_id\` + token as secrets.

---

## OpenAPI / Postman

-   Check in an `openapi.yaml` under `./docs` documenting at least:
    -   `POST /tenants/register`
    -   `POST /tenants/{tenantId}/templates`
    -   `POST /tenants/{tenantId}/flows`
    -   `POST /tenants/{tenantId}/send`
    -   `POST /whatsapp/webhook` (with both text inbound and button_reply inbound bodies)
-   Export a Postman collection for QA / partners using those endpoints.
-   Keep the OpenAPI schemas in sync with the new `interactive_button` template format and `content.kind` in the outbound job.

---

## Contributing

Add a `CONTRIBUTING.md` that covers:

-   Repo layout and conventions
-   Branching model: `main` protected; feature branches as `feat/<desc>`
-   Commit message style (Conventional Commits recommended)
-   Pull Request checklist:
    -   Lint passes
    -   Unit tests updated/added
    -   Integration tests for new endpoints (webhook, template save, etc.)
    -   README / OpenAPI updated
-   How to run tests locally and via Docker

---

## License

Add a `LICENSE` file (MIT or any OSI-approved license).  
Right now this project does not include a license; pick one before sharing code outside the team.

---

## Contact / Next steps

Things that can be added next:

-   Add `openapi.yaml` and a Postman collection checked into `docs/`.
-   Add `.env.example`, `Dockerfile.dev`, and `docker-compose.yml` to bootstrap local dev quickly.
-   Add a Jest test suite for:
    -   button reply routing (payloadId → nextTemplateKey),
    -   idempotency on auto-reply,
    -   webhook signature validation.
-   Add screenshots of the admin Template Builder UI under `docs/diagrams/` and reference them in this README.
-   Add a CI workflow (GitHub Actions) that runs lint + tests on PR.

---

## Run ESLint fixes inside Docker

Run lint / autofix inside containers to avoid local machine drift:

```bash
# run as a one-off container (build images first if needed)
docker compose run --rm app npm run lint

# run inside a running app service (start services first)
docker compose exec app sh -c "npm run lint"

# run using docker exec against a running container named `poc_app`
docker exec -it poc_app sh -c "npm run lint"
```

**Notes / best practices**

-   These commands assume Docker Compose v2 (`docker compose`).  
    If you only have legacy `docker-compose`, replace the command name accordingly.
-   `eslint --fix` will modify files on the host because the repo is volume-mounted.  
    Always do this on a branch so you can review changes in git.
-   Ensure dependencies are installed in the container image (or run `npm ci` inside the container) before linting.
-   If you want to avoid linting config files (like `eslint.config.cjs`), add them to `.eslintignore` or scope ESLint to `src/`.

---
