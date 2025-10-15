# WhatsApp Multi-Tenant Backend (Node.js + MongoDB + Docker)

A development-friendly proof of concept for a **multi-tenant WhatsApp SaaS backend**.  
Each tenant connects their own WhatsApp number (via Cloud API), and messages from customers are handled automatically.

This version includes:

-   MongoDB + Redis (BullMQ) persistence.
-   Auto-reply: each inbound message triggers a polite reply —
    ```
    thanks for reaching us
    - team <tenant.name>
    ```
-   Live reload (nodemon) inside Docker.

---

## 🏗️ Local Development Setup

### 1. Prerequisites

-   Docker + Docker Compose
-   Node.js ≥ 18 (optional, only for local testing)
-   Internet access (if you use real WhatsApp tokens)

### 2. Clone & configure

```bash
git clone <repo>
cd <repo>
cp .env.example .env
```

Edit `.env` and fill at least:

```env
MASTER_KEY=32_byte_random_string
APP_SECRET=your_meta_app_secret
VERIFY_TOKEN=local_verify_token_for_meta
MONGO_URI=mongodb://mongo:27017/pocdb
REDIS_HOST=redis
```

### 3. Run containers

```bash
docker-compose up --build
```

Services:
| Service | Port | Description |
|----------|------|-------------|
| `app` | 3000 | Express API |
| `worker` | – | BullMQ worker |
| `mongo` | 27017 | MongoDB |
| `mongo-express` | 8081 | Web UI (admin/pass) |
| `redis` | 6379 | Job queue |

---

## ⚙️ Endpoints

### 1. Health

```http
GET /health
```

Check service status.

### 2. Tenant Onboarding

```http
POST /tenants/register
Content-Type: application/json
```

```json
{
    "name": "Tenant A",
    "phoneNumberId": "111111111111111",
    "accessToken": "mock_token_tenant_A"
}
```

Registers a tenant.  
If token starts with `mock_`, messages are **simulated** (no Graph API call).

### 3. Send Message (outbound)

```http
POST /tenants/:tenantId/send
Content-Type: application/json
```

```json
{
    "to": "+919012345678",
    "text": "Hello there",
    "idempotency_key": "order-1234"
}
```

Queues an outbound message for the worker.  
Response:

```json
{
    "ok": true,
    "idempotency_key": "order-1234",
    "messageId": "6521a1..."
}
```

### 4. WhatsApp Webhook

#### Verify (GET)

```http
GET /whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=CHALLENGE
```

Responds with the challenge string if token matches.

#### Receive (POST)

```http
POST /whatsapp/webhook
Content-Type: application/json
```

Example payload (incoming message):

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

**Effect**

-   Saves inbound message → `messages` collection (`direction: "IN"`).
-   Creates/updates customer record.
-   Automatically enqueues an outbound reply:
    ```
    thanks for reaching us
    - team Tenant A
    ```

---

## 🔄 Auto-Reply Flow

1. **Customer** sends a message → WhatsApp → webhook.
2. **Webhook** identifies tenant by `phone_number_id`.
3. Saves inbound message and **creates queued outbound** message with body:
    ```
    thanks for reaching us
    - team <tenant.name>
    ```
4. **Worker** picks up queue, decrypts tenant token, and sends via WhatsApp Cloud API (or simulates if token starts with `mock_`).

All outbound messages use `idempotencyKey = auto-reply:<inbound-wa-message-id>` to prevent duplicates.

---

## 🗃️ Data Model (Mongo)

| Collection      | Purpose                                   |
| --------------- | ----------------------------------------- |
| `tenants`       | WhatsApp credential & metadata per tenant |
| `customers`     | End users by tenant                       |
| `messages`      | Inbound/outbound messages + statuses      |
| `conversations` | (Optional) conversation sessions          |

---

## 🔍 Monitoring

-   App logs
    ```bash
    docker-compose logs -f app
    ```
-   Worker logs
    ```bash
    docker-compose logs -f worker
    ```
-   Mongo-Express UI  
    <http://localhost:8081> (user: `admin`, pass: `pass`)

---

## 🧪 Testing Quickly

1. Register a tenant:
    ```bash
    curl -X POST http://localhost:3000/tenants/register      -H "Content-Type: application/json"      -d '{"name":"Tenant A","phoneNumberId":"111111111111111","accessToken":"mock_token_tenant_A"}'
    ```
2. Simulate incoming message:
    ```bash
    curl -X POST http://localhost:3000/whatsapp/webhook      -H "Content-Type: application/json"      -d '{"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"111111111111111"},"messages":[{"from":"+919111111111","id":"wamid.123","type":"text","text":{"body":"hi"}}]}}]}]}'
    ```
3. Observe worker logs — it will enqueue and “send” auto-reply.

---

## 🧰 Dev Tips

-   **Live reload:** nodemon restarts inside container on file changes.
-   **Reset DB:**
    ```bash
    docker-compose down -v && docker-compose up --build
    ```
-   **Shell into container:**
    ```bash
    docker exec -it poc_app /bin/sh
    ```

---

## 🧩 Future Improvements

-   Use Meta’s **Embedded Signup** flow for real tenant OAuth onboarding.
-   Per-tenant webhook signature verification (multi-APP_SECRET support).
-   Retry/DLQ + metrics dashboard.
-   UI frontend for tenants.

---

## 🧾 License

MIT – for educational and prototype use.
