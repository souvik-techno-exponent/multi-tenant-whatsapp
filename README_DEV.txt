README_DEV = {
    // Summary: short description of this PoC (multi-tenant WhatsApp backend using MongoDB + Redis)
    "Summary": "Multi-tenant WhatsApp PoC - MongoDB + Redis + BullMQ. Dev-friendly Docker setup with nodemon for live reload.",

    /*----------------------
    | SETUP / PREREQUISITES
    |----------------------*/
    "Prerequisites": {
        // Tools required for development
        "tools": [
            "Docker",
            "Docker Compose",
            "Node.js (optional if running outside docker)",
            "npm (optional)"
        ],
        // Copy .env.example to .env and fill values
        "env_note": "Copy .env.example to .env and fill the variables listed in `EnvVariables` below."
    },

    /*----------------------
    | ENV VARIABLES (examples)
    |----------------------*/
    "EnvVariables": {
        // Keep secrets secure locally; MASTER_KEY must be >= 32 chars for AES-256-GCM in PoC
        "APP_SECRET": "your_meta_app_secret_here",
        "VERIFY_TOKEN": "local_verify_token_for_meta",
        "MASTER_KEY": "32_byte_random_string_here",
        "MONGO_URI": "mongodb://mongo:27017/pocdb",
        "REDIS_HOST": "redis",
        "REDIS_PORT": 6379,
        "WHATSAPP_API_VERSION": "v20.0",
        "PORT": 3000
    },

    /*----------------------
    | QUICK START (development)
    |----------------------*/
    "QuickStart": {
        "build_and_start_first_time": "docker-compose up --build",
        "start_after_build": "docker-compose up",
        "app_url": "http://localhost:3000",
        "mongo_express_url": "http://localhost:8081  (user: admin / pass: pass)"
    },

    /*----------------------
    | DEV WORKFLOW / LIVE RELOAD
    |----------------------*/
    "DevWorkflow": {
        // Files are mounted into containers; nodemon watches src/ and restarts automatically
        "watch": "nodemon watches `src/` and restarts the server on file changes.",
        "add_dependency_note": "If you add new npm dependency, rebuild images: docker-compose build app worker",
        "logs": [
            "docker-compose logs -f app",
            "docker-compose logs -f worker"
        ]
    },

    /*----------------------
    | PROJECT LAYOUT (short)
    |----------------------*/
    "ProjectLayout": {
        // Top-level files and key src files
        "root_files": [
            "docker-compose.yml",
            "Dockerfile.dev",
            ".env.example",
            "nodemon.json",
            "package.json"
        ],
        "src": {
            "index.js": "server entrypoint (connects to DB then starts express app)",
            "app.js": "express wiring and routes",
            "db.js": "mongoose connect with retry logic",
            "models.js": "Mongoose schemas (Tenant, Customer, Conversation, Message)",
            "tenantService.js": "tenant helpers, encrypt/decrypt token",
            "sendController.js": "enqueue outbound sends into BullMQ",
            "webhook.js": "webhook verify + routing by metadata.phone_number_id",
            "worker.js": "BullMQ worker logic (send jobs)",
            "workerProcess.js": "worker container entrypoint",
            "utils/crypto.js": "AES-256-GCM encrypt/decrypt (POC)",
            "middlewares/rawBody.js": "capture raw body for signature verification"
        }
    },

    /*----------------------
    | API (POC) - endpoints & examples
    |----------------------*/
    "API": {
        // Register tenant (POC - manual token supply for dev)
        "register_tenant": {
            "method": "POST",
            "path": "/tenants/register",
            "headers": { "Content-Type": "application/json" },
            "body_example": {
                "name": "Tenant A",
                "phoneNumberId": "111111111111111",
                "accessToken": "mock_token_tenant_A"
            },
            "note": "In production use Embedded Signup flow; do NOT ask tenants to paste tokens."
        },

        // Enqueue outbound message
        "send_message": {
            "method": "POST",
            "path": "/tenants/:tenantId/send",
            "body_example": {
                "to": "+919xxxxxxxxx",
                "text": "Hello from tenant A",
                "idempotency_key": "order-1234   // optional"
            },
            "note": "Creates DB message record with status=queued and enqueues job to BullMQ."
        },

        // Webhook verification
        "webhook_verify": {
            "method": "GET",
            "path": "/whatsapp/webhook",
            "query": "hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=<challenge>",
            "response": "returns hub.challenge when verify token matches configured VERIFY_TOKEN"
        },

        // Webhook event (WhatsApp -> POST)
        "webhook_post": {
            "method": "POST",
            "path": "/whatsapp/webhook",
            "headers_required": "X-Hub-Signature-256 (if APP_SECRET set)",
            "note": "Payload must include metadata.phone_number_id to route to tenant"
        }
    },

    /*----------------------
    | CURL EXAMPLES (POC)
    |----------------------*/
    "CurlExamples": {
        "register": "curl -X POST http://localhost:3000/tenants/register -H \"Content-Type: application/json\" -d '{\"name\":\"Tenant A\",\"phoneNumberId\":\"111111111111111\",\"accessToken\":\"mock_token_tenant_A\"}'",
        "send": "curl -X POST http://localhost:3000/tenants/<TENANT_ID>/send -H \"Content-Type: application/json\" -d '{\"to\":\"+919xxxxxxxxx\",\"text\":\"Hello from tenant A\",\"idempotency_key\":\"order-1234\"}'",
        "simulate_webhook": "curl -X POST http://localhost:3000/whatsapp/webhook -H \"Content-Type: application/json\" -d '{\"entry\":[{\"changes\":[{\"value\":{\"metadata\":{\"phone_number_id\":\"111111111111111\"},\"messages\":[{\"from\":\"+919111111111\",\"id\":\"wamid.123\",\"type\":\"text\",\"text\":{\"body\":\"hi\"}}]}}]}]}'"
    },

    /*----------------------
    | DATA MODEL (conceptual)
    |----------------------*/
    "DataModel": {
        "Tenant": {
            "_id": "ObjectId",
            "name": "string",
            "phoneNumberId": "string (unique)",
            "wabaId": "string",
            "accessTokenEnc": "encrypted string",
            "status": "connected|disconnected",
            "timestamps": "createdAt, updatedAt"
        },
        "Customer": {
            "tenantId": "ObjectId",
            "waId": "E.164 string",
            "name": "string",
            "lastSeenAt": "Date"
        },
        "Message": {
            "tenantId": "ObjectId",
            "conversationId": "ObjectId (optional)",
            "direction": "IN|OUT",
            "waMessageId": "string",
            "body": "string",
            "idempotencyKey": "string (partial unique index by tenant)",
            "status": "queued|sent|delivered|read|failed",
            "createdAt": "Date"
        }
    },

    /*----------------------
    | RELIABILITY / QUEUE / IDEMPOTENCY
    |----------------------*/
    "Reliability": {
        "queue": "BullMQ queue named 'whatsapp-send-queue' (attempts:5, exponential backoff)",
        "idempotency": "Mongo partial unique index on (tenantId, idempotencyKey). Pre-check before enqueue.",
        "worker": "Worker checks message.status to avoid duplicate sends. On local env, tokens starting with 'mock_' simulate sends."
    },

    /*----------------------
    | SECURITY & SECRETS (POC vs PROD)
    |----------------------*/
    "Security": {
        "POC": "AES-256-GCM encryption using MASTER_KEY from .env (not secure for prod).",
        "PROD": "Use cloud KMS (AWS KMS / GCP KMS) or Secrets Manager. Rotate tokens regularly.",
        "webhook_signature": "Verify X-Hub-Signature-256 (HMAC-SHA256 of raw body with APP_SECRET)."
    },

    /*----------------------
    | DEBUGGING / TROUBLESHOOTING
    |----------------------*/
    "Troubleshooting": {
        "logs": [
            "docker-compose logs -f app",
            "docker-compose logs -f worker",
            "docker-compose logs -f mongo",
            "docker-compose logs -f redis"
        ],
        "nodemon_restarts": "If nodemon restarts too often, check for file-change loops. Rebuild images if node_modules mismatch.",
        "webhook_verification": "Ensure APP_SECRET matches Meta app secret and raw body is used to compute signature."
    },

    /*----------------------
    | PRODUCTION CONSIDERATIONS (short)
    |----------------------*/
    "ProductionNotes": {
        "workers": "Run workers as separate processes/containers and autoscale independently.",
        "DLQ": "Implement dead-letter queue for permanently failing jobs.",
        "observability": "Add metrics (Prometheus), centralized logging (ELK/Loki), tracing.",
        "rate_limits": "Enforce per-tenant rate limits and quotas to avoid noisy tenants.",
        "onboarding": "Implement Meta Embedded Signup for proper onboarding; do not accept raw tokens."
    },

    /*----------------------
    | NEXT STEPS / OPTIONAL ADD-ONS
    |----------------------*/
    "NextSteps": {
        "embedded_signup": "Add Embedded Signup flow (server + callback) to onboard tenants without manual tokens.",
        "kms_integration": "Replace MASTER_KEY approach with KMS-backed encryption (AWS/GCP).",
        "prod_manifests": "Create production Dockerfile, Kubernetes manifests, and Helm chart.",
        "tests_ci": "Add automated tests (Jest + supertest) and CI pipeline."
    },

    /*----------------------
    | CONTACT / HELP
    |----------------------*/
    "Contact": {
        "offer": "If you want, I can generate a ZIP of the project, add Embedded Signup code, integrate KMS example, or produce production manifests.",
        "how_to_request": "Reply with which next step you want and I will provide the code/config."
    }
}
