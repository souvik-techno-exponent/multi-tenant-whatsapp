# Dev Dockerized PoC - WhatsApp Multi-tenant (Mongo)

## Quick start

1. Copy `.env.example` to `.env` and fill values (MASTER_KEY at least 32 chars).
2. Build & start: docker-compose up --build
3. API available at: http://localhost:3000

-   Register tenant: POST `/tenants/register`
-   Send message: POST `/tenants/:tenantId/send`
-   Webhook: POST `/whatsapp/webhook`

4. Mongo UI (mongo-express): http://localhost:8081 (user admin / pass pass)

## Notes for live edit

-   Files are mounted into container; nodemon watches `src/` and restarts on change.
-   If you add new dependencies, rebuild image: `docker-compose build app worker`.
-   Use `docker-compose logs -f app` or `docker-compose logs -f worker` to stream logs.

## Example cURL

Register:
curl -X POST http://localhost:3000/tenants/register

-H "Content-Type: application/json"
-d '{"name":"Tenant A","phoneNumberId":"111111111111111","accessToken":"mock_token_tenant_A"}'

Send:
curl -X POST http://localhost:3000/tenants/
<TENANT_ID>/send
-H "Content-Type: application/json"
-d '{"to":"+919xxxxxxxxx","text":"Hello from tenant A", "idempotency_key":"order-1234"}'
