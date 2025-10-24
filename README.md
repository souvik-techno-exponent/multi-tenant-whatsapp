# Project README

This repository contains the messaging backend and related services.

## Table of Contents

-   Quick Start
-   Environment
-   Running locally (development)
-   API: Templates
-   API: Flows
-   API: Sending messages
-   Webhook security (signature verification)
-   Idempotency & retries
-   Errors & status codes
-   Postman / OpenAPI
-   Contributing

---

## Quick Start

Follow these steps to run the app locally for development.

1. Copy environment file:

```bash
cp .env.example .env
# edit .env to set MONGO_URI, REDIS, APP_SECRET etc.
```

2. Install dependencies:

```bash
# backend
cd server
npm install

# frontend (if applicable)
cd ../client
npm install
```

3. Start services (local development):

```bash
# start redis & mongodb (e.g. docker compose) or ensure they are running
npm run dev # runs the backend with nodemon
```

If you prefer Docker, add a `Dockerfile.dev` or `docker-compose.yml` in the repo root and update this section accordingly.

---

## Environment

Add a `.env.example` file to the repo root with the following keys (example values).
Keep secrets out of the repo; use environment variables or a secrets manager in production.

```text
# .env.example (DO NOT COMMIT real secrets)
APP_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017/messaging
REDIS_URL=redis://localhost:6379
APP_SECRET=your_app_secret_here
VERIFY_TOKEN=webhook_verify_token
MASTER_KEY=master_key_for_admin_ops
VITE_API_BASE=http://localhost:3000/api
```

Ensure README points to `.env.example` and instructs developers to create `.env` from it.

---

## API: Templates

Create a template for a tenant.

**POST** `/tenants/:tenantId/templates`

Request example:

```bash
curl -X POST "http://localhost:3000/api/tenants/tenant_123/templates" \
  -H "Authorization: Bearer <MASTER_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "welcome_v1",
    "language": "en",
    "components": [
      {
        "type": "body",
        "text": "Hello {{first_name}}, welcome to our service!"
      }
    ],
    "metadata": {
      "description": "Welcome message"
    }
  }'
```

Expected 201 response: created template JSON.

Notes:

-   Validation: `key` must be unique per tenant.
-   Versioning: when updating, consider storing `version` or `updatedAt`.

---

## API: Flows

Create or update conversational flows for a tenant.

**POST** `/tenants/:tenantId/flows`

Request example:

```bash
curl -X POST "http://localhost:3000/api/tenants/tenant_123/flows" \
  -H "Authorization: Bearer <MASTER_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "flows": [
      {
        "id": "greeting_flow",
        "match": { "contains": ["hello", "hi"] },
        "action": { "type": "send_template", "templateKey": "welcome_v1" }
      }
    ],
    "fallbackTemplateKey": "fallback_v1"
  }'
```

Response: 200 with saved flows.

Document the flow rule schema (simple boolean operators, contains, regex, exact) and any limits (max rules).

---

## API: Sending messages

There are two primary paths:

-   **Send raw message** (custom payload)  
    **POST** `/tenants/:tenantId/send`

-   **Send using a stored template**  
    **POST** `/tenants/:tenantId/send/template`

Template send example:

```bash
curl -X POST "http://localhost:3000/api/tenants/tenant_123/send/template" \
  -H "Authorization: Bearer <MASTER_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "templateKey": "welcome_v1",
    "variables": { "first_name": "Sam" },
    "idempotency_key": "send:order:12345"
  }'
```

Notes:

-   `idempotency_key` should be supplied by clients to prevent duplicate sends.
-   System also uses auto-generated idempotency keys for worker retries.

---

## Webhook security (signature verification)

Incoming webhooks (e.g. WhatsApp webhook) MUST be verified. Example `openssl` command:

```bash
# compute HMAC-SHA256 over raw request body using APP_SECRET
echo -n '<raw-body>' | openssl dgst -sha256 -hmac "$APP_SECRET"
```

Node example (Express.js raw body):

```js
// express route example
const crypto = require("crypto");

function verifySignature(rawBody, signatureHeader, secret) {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Implement `rawBody` capture (e.g. `express.raw({ type: '*/*' })`) to ensure exact bytes are used for HMAC.

---

## Idempotency & retries

Behaviour:

-   The API accepts `idempotency_key` for sends. The server will persist and reject duplicate requests with the same key.
-   Auto-replies use idempotency keys in the format: `auto-reply:<inboundId>` to avoid sending duplicate auto responses.
-   Workers must be idempotent: storing `message.status` and using unique constraints (e.g. unique on `externalId` or `idempotencyKey`) to avoid duplicates.

Example idempotency collision response:

```json
{
    "error": "Conflict",
    "message": "Request with the given idempotency_key already processed"
}
```

---

## Errors & status codes

Common responses:

-   `400 Bad Request` — validation error or missing required data.
-   `401 Unauthorized` — missing/invalid auth token.
-   `404 Not Found` — resource not found (e.g. template key).
-   `409 Conflict` — duplicate resource or idempotency conflict (Mongo duplicate key).
-   `500 Internal Server Error` — unexpected server error.

Include sample error bodies in the API responses for clarity.

---

## Postman / OpenAPI

Provide an OpenAPI (Swagger) skeleton or Postman collection in the `docs/` folder.
At minimum include endpoints:

-   `/tenants/{tenantId}/templates`
-   `/tenants/{tenantId}/flows`
-   `/tenants/{tenantId}/send`
-   `/webhook`

This accelerates testing and onboarding for QA and integrators.

---

## Contributing

Please add a `CONTRIBUTING.md` describing:

-   Repo layout
-   Branching model (e.g., `main` protected, feature branches `feat/*`)
-   PR checklist (lint, tests, changelog)
-   How to run unit and integration tests (Jest + supertest recommended)

---

## Diagrams (recommended)

Add a small sequence diagram or PNG in `docs/diagrams/` showing:
`inbound webhook -> router -> persist -> flow engine -> enqueue -> worker -> external API`

Add a simple ER diagram for core models: Tenant, Customer, Message, Template, Flow.

---

## Notes

This README patch focuses on filling the critical gaps:

-   `.env.example` mention and example
-   webhook signature verification snippet
-   API examples for templates, flows, sending
-   idempotency and error codes

Add further detail to each API section (schemas, full example responses) as you stabilize the contract.

# WhatsApp Multi‑Tenant Backend (Node.js + MongoDB + Docker)

A development-friendly proof of concept for a **multi-tenant WhatsApp SaaS backend**.  
Each tenant connects their own WhatsApp number (via Cloud API), and messages from customers are handled automatically.

**This merged, up‑to‑date README** consolidates the previous structured notes and the latest README. Stale/duplicate sections have been removed.

---

## Summary

Multi-tenant WhatsApp PoC using:

-   Node.js + Express
-   MongoDB (Mongoose)
-   Redis + BullMQ (job queue)
-   Dev Docker setup with `nodemon` for live reload

Features:

-   Tenant onboarding (PoC manual token)
-   Shared webhook that routes inbound events to correct tenant via `metadata.phone_number_id`
-   Outbound send queue with retries & idempotency
-   Auto-reply: every inbound message triggers:
    ```
    thanks for reaching us
    - team <tenant.name>
    ```
-   Dev-friendly Docker compose (app + worker + mongo + redis + mongo-express)

---

## Prerequisites

-   Docker & Docker Compose
-   Node.js (optional if running inside Docker)
-   npm (optional)
-   Copy `.env.example` → `.env` and fill values.

**Env variables (examples)**

```env
APP_SECRET=your_meta_app_secret_here
VERIFY_TOKEN=local_verify_token_for_meta
MASTER_KEY=32_byte_random_string_here   # >=32 chars for AES-256-GCM in PoC
MONGO_URI=mongodb://mongo:27017/pocdb
REDIS_HOST=redis
REDIS_PORT=6379
WHATSAPP_API_VERSION=v20.0
PORT=3000
```

> Security note: `MASTER_KEY` encryption in this PoC is for convenience only. In production use a KMS / Secrets Manager and rotate tokens.

---

## Quick start (development)

1. Copy `.env.example` to `.env` and fill values.
2. Build and start:

```bash
docker-compose up --build
```

3. App URL: `http://localhost:3000`  
   Mongo-express UI: `http://localhost:8081` (user: `admin`, pass: `pass`)

Dev workflow:

-   Files are mounted into the container; `nodemon` watches `src/` and restarts the server on change.
-   If you add new dependencies, rebuild images:
    ```bash
    docker-compose build app worker
    ```
-   Tail logs:
    ```bash
    docker-compose logs -f app
    docker-compose logs -f worker
    ```

---

## Project layout (key files)

```

docker-compose.yml
Dockerfile.dev
.env.example
nodemon.json
package.json
src/
index.js # server entrypoint
app.js # express wiring & routes
db.js # mongoose connect (with retry)
models.js # Mongoose schemas (Tenant, Customer, Message, Conversation)
tenantService.js # tenant helpers + encrypt/decrypt token
sendController.js # enqueue outbound sends
webhook.js # webhook verify + routing by metadata.phone_number_id
worker.js # BullMQ worker logic (send jobs)
workerProcess.js # worker container entrypoint
utils/crypto.js # AES-256-GCM encrypt/decrypt (POC)
middlewares/rawBody.js # capture raw body for signature verification

```

---

## API reference (for Postman / curl)

> Base URL: `http://localhost:3000`

### 1) Health

```

GET /health

```

Response:

```json
{ "ok": true }
```

### 2) Register tenant (PoC)

```
POST /tenants/register
Content-Type: application/json
```

Body:

```json
{
    "name": "Tenant A",
    "phoneNumberId": "111111111111111",
    "accessToken": "mock_token_tenant_A"
}
```

Notes: In production use Embedded Signup. `mock_` tokens simulate sends.

Curl:

```bash
curl -X POST http://localhost:3000/tenants/register   -H "Content-Type: application/json"   -d '{"name":"Tenant A","phoneNumberId":"111111111111111","accessToken":"mock_token_tenant_A"}'
```

### 3) Send message (outbound)

```
POST /tenants/:tenantId/send
Content-Type: application/json
```

Body:

```json
{
  "to": "+919012345678",
  "text": "Hello there",
  "idempotency_key": "order-1234"  # optional but recommended
}
```

Curl:

```bash
curl -X POST http://localhost:3000/tenants/<TENANT_ID>/send  -H "Content-Type: application/json"  -d '{"to":"+919012345678","text":"Hello","idempotency_key":"order-1234"}'
```

Creates DB message (status=queued) and enqueues a job.

### 4) Webhook verification (Meta)

```
GET /whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=<challenge>
```

Responds with challenge if token matches.

### 5) Webhook POST (incoming events)

```
POST /whatsapp/webhook
Content-Type: application/json
Headers: X-Hub-Signature-256: sha256=<hex>  # required if APP_SECRET set
```

Example body:

```json
{
    "entry": [
        {
            "changes": [
                {
                    "value": {
                        "metadata": { "phone_number_id": "111111111111111" },
                        "messages": [{ "from": "+919111111111", "id": "wamid.123", "type": "text", "text": { "body": "hi" } }]
                    }
                }
            ]
        }
    ]
}
```

Effect:

-   Persists inbound `Message` with `direction: IN`.
-   Upserts `Customer`.
-   **Auto-reply**: enqueues an outbound message with body:
    ```
    thanks for reaching us
    - team <tenant.name>
    ```
    The auto-reply uses idempotency key `auto-reply:<inbound-wa-message-id>`.

How to compute signature (if APP_SECRET set):

-   Use exact raw JSON body and compute HMAC-SHA256 with `APP_SECRET` and prefix with `sha256=`. Examples with `openssl` or Node.js are in the earlier docs.

---

## Data model (conceptual)

**Tenant**

-   `_id`, `name`, `phoneNumberId` (unique), `wabaId`, `accessTokenEnc`, `status`, timestamps

**Customer**

-   `tenantId`, `waId` (E.164), `name`, `lastSeenAt`

**Message**

-   `tenantId`, `conversationId?`, `direction` (`IN|OUT`), `waMessageId`, `body`, `idempotencyKey`, `status` (`queued|sent|delivered|read|failed`), timestamps

---

## Reliability, queue & idempotency

-   Queue: BullMQ with queue name `whatsapp-send-queue`. Jobs: attempts=5, exponential backoff.
-   Idempotency: Mongo partial unique index on `(tenantId, idempotencyKey)` prevents duplicate sends per tenant. Pre-checks in controller avoid duplicates. Worker checks message.status before sending.
-   Mock tokens: tokens starting with `mock_` are simulated in worker (no external API call) — useful for dev.

---

## Security & secrets

-   PoC: AES-256-GCM encryption using `MASTER_KEY` from `.env`. Not production-grade.
-   Prod: Use Cloud KMS / Secrets Manager, rotate secrets, apply least privilege.
-   Webhook signature: verify `X-Hub-Signature-256` as `sha256=HMAC(APP_SECRET, rawBody)`.

---

## Troubleshooting & monitoring

-   Logs:
    ```bash
    docker-compose logs -f app
    docker-compose logs -f worker
    docker-compose logs -f mongo
    docker-compose logs -f redis
    ```
-   Mongo UI: `http://localhost:8081` (admin / pass)
-   If nodemon restarts too often, check for file-change loops or volume mounts.
-   If webhook 401: ensure signature computed on exact raw body.

---

## Production considerations

-   Run workers in separate processes/hosts; autoscale independently.
-   Implement DLQ (dead-letter queue) for permanently failing jobs.
-   Add observability: metrics (Prometheus), centralized logs, tracing.
-   Enforce per-tenant rate limits; monitor noisy tenants.
-   Use Meta Embedded Signup for tenant onboarding (don't accept raw tokens).

---

## Next steps (optional add-ons)

-   Add Embedded Signup / OAuth server flow.
-   Integrate KMS (AWS/GCP) for token encryption at rest.
-   Add production Dockerfile and Kubernetes manifests / Helm chart.
-   Add tests (Jest + supertest) and CI pipeline.
-   Add Postman collection (I can generate it).

---

## Contact / Help

If you want, I can:

-   generate a ZIP of the project,
-   add Embedded Signup code,
-   integrate KMS example,
-   produce production manifests,
-   generate a Postman collection for quick import.

Reply with which next step you want.

---

# WhatsApp Multi-Tenant Backend (Node.js + MongoDB + Docker)

A development-friendly proof of concept for a **multi-tenant WhatsApp SaaS backend**.
Each tenant connects their own WhatsApp number (via Cloud API), and messages from customers are handled automatically.

---

## Quick Start (Backend)

Prerequisites:

-   Docker & Docker Compose installed
-   Environment variables configured as per `.env` in project root

Start the entire stack (recommended):

```bash
docker-compose up --build
```

This will build and start backend services, database, and optional worker services.

-   Backend API: `http://localhost:3000`
-   Mongo Express (if enabled): `http://localhost:8081`

---

## Frontend (Vite + React + MUI)

A minimal React UI to test the backend:

-   Health check (`GET /health`)
-   Register tenant (`POST /tenants/register`)
-   Send message (`POST /tenants/:tenantId/send`)

### Start (dev)

**Recommended: start the whole stack** so that the Vite dev server inside Docker can proxy to the backend service name `app`:

```bash
docker-compose up --build
```

**Or** start backend and frontend together:

```bash
docker-compose up --build app frontend
```

Open the UI at: `http://localhost:5173`

### Notes

-   The Vite dev server is configured to proxy `/api/*` to the internal Docker hostname `http://app:3000`. This means that when both frontend and backend run in the same Docker Compose network, there is **no CORS** friction.
-   Hot reload (HMR) is enabled and configured to work reliably inside containers by:
    -   setting `CHOKIDAR_USEPOLLING: "true"` in the frontend service environment, and
    -   enabling `watch.usePolling: true` in `vite.config.ts`.
-   If you run the frontend directly on your **host machine** (not inside Docker), the Vite proxy `http://app:3000` will not resolve. In that case set the API base to your host backend address.

### Running frontend on host (outside Docker)

1. Create a `.env` file inside `frontend/`:

    ```
    VITE_API_BASE=http://localhost:3000
    ```

2. From `frontend/` directory run:
    ```bash
    npm install
    npm run dev
    ```

Now the frontend will call `http://localhost:3000` directly.

### Vite proxy details (dev inside Docker)

`vite.config.ts` contains:

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://app:3000',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}
```

This maps browser requests to `http://localhost:5173/api/...` to the backend service `app:3000`.

---

## Frontend file layout (created by the PoC)

```
frontend/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ lib/
   │  └─ api.ts
   └─ pages/
      ├─ HealthCheck.tsx
      ├─ TenantRegister.tsx
      └─ SendMessage.tsx
```

### API helper (frontend/src/lib/api.ts)

The frontend API client uses a Vite environment variable fallback:

```ts
const BASE = import.meta.env.VITE_API_BASE ?? "/api";
```

-   When inside Docker Compose, `/api` is proxied to `http://app:3000`.
-   When running on host, set `VITE_API_BASE` to `http://localhost:3000`.

---

## Troubleshooting

-   **Vite proxy returns connection errors**: likely the backend (`app`) is not yet ready. Start backend and frontend together with `docker-compose up --build` or ensure `app` is running on host if running frontend outside Docker.
-   **HMR not updating**: ensure the `frontend` volume is mounted (`./frontend:/usr/src/app`) and `CHOKIDAR_USEPOLLING` is set. Also ensure your editor writes files to the mounted path (some editors create temp files).
-   **Crypto/runtime errors**: ensure `MASTER_KEY` environment variable is set. Use the provided `src/utils/crypto.ts` which derives a 32-byte key using SHA-256 to tolerate varying key lengths.

---

## Development Tips

-   To avoid installing node_modules on container start repeatedly, consider adding a simple `Dockerfile` for the frontend that runs `npm ci` during build. For pure dev, the current setup installs on container start for convenience.
-   If you want the frontend to wait until backend health is ready, you can add a small health-check loop in the frontend command; this is optional and mostly helpful when starting frontend alone.
-   Keep backend logs visible: `docker-compose logs -f app` is useful while developing.

---

## Contact / Next steps

If you want, I can:

-   produce a `Dockerfile` for the frontend to speed up restarts,
-   add a small `wait-for-app.sh` wrapper so the frontend waits for backend health,
-   make `frontend` use a dedicated `Dockerfile` and multi-stage build.
