# --------------------------------------------------------------------------------
# README_DEV — WhatsApp Multi-tenant PoC (MongoDB)
# --------------------------------------------------------------------------------

# Summary:
# This file describes a development-friendly Dockerized PoC for a multi-tenant
# WhatsApp backend using MongoDB + Redis + BullMQ.  Use nodemon for live reload.
#
# Note (বাংলা):
# এটি plain-text, code-comment style README। comments are in English; overall
# guidance lines are in Bengali elsewhere above. Open in an editor for best view.
#
# ----------------------
# SETUP / PREREQUISITES
# ----------------------
# 1) Required tools:
# - Docker & Docker Compose
# - Node.js & npm (optional for local non-docker runs)
#
# 2) Copy environment variables:
# - Copy `.env.example` to `.env` and fill values.
#
# 3) Important env vars (examples):
# APP_SECRET=your_meta_app_secret_here
# VERIFY_TOKEN=local_verify_token_for_meta
# MASTER_KEY=32_byte_random_string_here
# MONGO_URI=mongodb://mongo:27017/pocdb
# REDIS_HOST=redis
# REDIS_PORT=6379
# WHATSAPP_API_VERSION=v20.0
# PORT=3000
#
# ----------------------
# QUICK START (DEV)
# ----------------------
# Step 1: Build and start containers (first time or when deps change)
# docker-compose up --build
#
# Step 2: Start normally (after first build)
# docker-compose up
#
# App endpoints:
# API:            [http://localhost:3000](http://localhost:3000)
# Mongo Express:  [http://localhost:8081](http://localhost:8081)   (user: admin / pass: pass)
#
# ----------------------
# LIVE EDIT / DEV WORKFLOW
# ----------------------
# - Source code is mounted into containers with volumes.
# - nodemon watches `src/` and restarts the process automatically on file change.
# - When you add new npm dependencies, rebuild the images:
# docker-compose build app worker
# - Tail logs to observe behavior:
# docker-compose logs -f app
# docker-compose logs -f worker
#
# ----------------------
# PROJECT LAYOUT (short)
# ----------------------
# Root:
# docker-compose.yml
# Dockerfile.dev
# .env.example
# nodemon.json
# package.json
# /src
# index.js            # server entrypoint
# app.js              # express wiring
# db.js               # mongoose connect with retry
# models.js           # mongoose schemas (Tenant, Customer, Message...)
# tenantService.js    # tenant helpers, encrypt/decrypt token
# sendController.js   # enqueue outbound sends
# webhook.js          # webhook verify + routing
# worker.js           # BullMQ worker logic
# workerProcess.js    # worker container entrypoint
# /utils/crypto.js    # AES-256-GCM (POC) encrypt/decrypt
# /middlewares/rawBody.js
#
# ----------------------
# API (POC) — Endpoints & Examples
# ----------------------
# 1) Register tenant (POC onboarding: manual token input)

# POST /tenants/register

# Headers:

# Content-Type: application/json

# Body example:

# {

# "name": "Tenant A",

# "phoneNumberId": "111111111111111",

# "accessToken": "mock_token_tenant_A"

# }

#

# 2) Send message (enqueue)

# POST /tenants/:tenantId/send

# Body example:

# {

# "to": "+919xxxxxxxxx",

# "text": "Hello from tenant A",

# "idempotency_key": "order-1234"   # optional

# }

#

# 3) Webhook verification (Meta)

# GET /whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=<challenge>

# - Server returns challenge when verify_token matches VERIFY_TOKEN

#

# 4) Webhook event (WhatsApp -> POST)

# POST /whatsapp/webhook

# - Include header: X-Hub-Signature-256 when APP_SECRET is set

# - Payload follows WhatsApp Cloud API structure with metadata.phone_number_id

#

# ----------------------

# CURL EXAMPLES (POC)

# ----------------------

# Register tenant:

# curl -X POST [http://localhost:3000/tenants/register](http://localhost:3000/tenants/register) \

# -H "Content-Type: application/json" \

# -d '{"name":"Tenant A","phoneNumberId":"111111111111111","accessToken":"mock_token_tenant_A"}'

#

# Send message:

# curl -X POST [http://localhost:3000/tenants/](http://localhost:3000/tenants/)<TENANT_ID>/send \

# -H "Content-Type: application/json" \

# -d '{"to":"+919xxxxxxxxx","text":"Hello from tenant A", "idempotency_key":"order-1234"}'

#

# Simulate incoming webhook (no signature if APP_SECRET not set):

# curl -X POST [http://localhost:3000/whatsapp/webhook](http://localhost:3000/whatsapp/webhook) \

# -H "Content-Type: application/json" \

# -d '{

# "entry":[

# {

# "changes":[

# {

# "value":{

# "metadata":{"phone_number_id":"111111111111111"},

# "messages":[{"from":"+919111111111","id":"wamid.123","type":"text","text":{"body":"hi"}}]

# }

# }

# ]

# }

# ]

# }'

#

# ----------------------

# DATA MODEL (conceptual)

# ----------------------

# Tenant:

# - _id

# - name

# - phoneNumberId (unique)

# - wabaId

# - accessTokenEnc (encrypted)

# - status, timestamps

#

# Customer:

# - tenantId (ObjectId)

# - waId (E.164)

# - name, lastSeenAt

#

# Message:

# - tenantId

# - conversationId (optional)

# - direction: IN / OUT

# - waMessageId

# - body, type

# - idempotencyKey (partial unique index per tenant)

# - status (queued, sent, delivered, failed)

#

# ----------------------

# RELIABILITY / IDMPOTENCY / QUEUE

# ----------------------

# - Outbound sends are enqueued into BullMQ "whatsapp-send-queue".

# - Jobs use attempts: 5 and exponential backoff.

# - DB has a partial unique index on (tenantId, idempotencyKey) to prevent duplicates.

# - Worker checks message.status before sending to ensure idempotency.

# - For local dev, if tenant access token starts with "mock_" worker simulates send.

#

# ----------------------

# SECURITY & SECRETS (POC vs PROD)

# ----------------------

# - POC: AES-256-GCM using MASTER_KEY stored in .env (NOT for production).

# - Production: use cloud KMS (AWS KMS / GCP KMS) or Secrets Manager; rotate keys.

# - Webhook signature verification: X-Hub-Signature-256 (HMAC-SHA256 of raw body with APP_SECRET).

# - Always store per-tenant tokens encrypted and restrict access to DB.

#

# ----------------------

# DEBUG / TROUBLESHOOTING

# ----------------------

# - Check container logs:

# docker-compose logs -f app

# docker-compose logs -f worker

# docker-compose logs -f mongo

# docker-compose logs -f redis

#

# - If nodemon restarts too frequently:

# * Ensure no infinite file-change loop caused by mounted volumes.

# * Rebuild images if node_modules mismatch:

# docker-compose build app worker

#

# - If webhook verification fails:

# * Confirm APP_SECRET in .env matches Meta App secret.

# * Ensure request body used to compute signature is raw (middleware captures rawBody).

#

# ----------------------

# PRODUCTION CONSIDERATIONS (short list)

# ----------------------

# - Separate worker processes and autoscale.

# - Implement DLQ (dead-letter queue) for permanently failing jobs.

# - Add metrics (Prometheus), structured logs (ELK / Loki), and tracing.

# - Enforce per-tenant rate limits and quota controls.

# - Replace MASTER_KEY with KMS-backed encryption and secret rotation.

# - Implement Embedded Signup (Meta) for onboarding—do not ask tenants to paste tokens.

#

# ----------------------

# NEXT STEPS (you can request any of these)

# ----------------------

# - Add Embedded Signup flow scaffold (server + callback).

# - Add KMS integration for tokens.

# - Provide production Dockerfile + Kubernetes manifests + Helm chart.

# - Add automated tests (Jest + supertest) and CI pipeline.

#

# ----------------------

# CONTACT / HELP

# ----------------------

# If you want, I can:

# - generate a zip of the whole project,

# - add Embedded Signup code,

# - integrate KMS example,

# - or produce production manifests.

#

