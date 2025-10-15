প্রকল্প সারসংক্ষেপ

এই ডেভেলপমেন্ট-ফ্রেন্ডলি PoC সার্ভিসটি MongoDB ও Redis ব্যবহার করে মাল্টি-টেন্যান্ট WhatsApp ব্যাকএন্ড দেখায়।
প্রধান ফিচার:

টেন্যান্ট অনবোর্ডিং (পোচ: /tenants/register)

শেয়ার্ড webhook (রাউট করে metadata.phone_number_id দ্বারা)

আউটবাউন্ড send (টেন্যান্ট-স্কোপ টোকেন ও phone_number_id ব্যবহার করে)

ডাটা আইসোলেশন (tenantId), idempotency এবং BullMQ-ভিত্তিক retry/backoff

development-friendly Docker setup — nodemon + volume mounts => কোড পরিবর্তন করলে তাত্ক্ষণিক আপডেট

ফাইল অবস্থান / প্রকল্প গঠন (সংক্ষিপ্ত)

docker-compose.yml => dev containers (app, worker, mongo, redis, mongo-express)

Dockerfile.dev => development image

.env.example => পরিবেশ ভেরিয়েবল

nodemon.json => nodemon কনফিগ

src/

index.js => server entrypoint

app.js => express app wiring

db.js => mongoose connect (retry)

models.js => Mongoose schemas/models

tenantService.js => tenant helpers (encrypt/decrypt)

sendController.js => enqueue send jobs

webhook.js => webhook verify + routing

worker.js => BullMQ worker logic

workerProcess.js => worker container entrypoint

utils/crypto.js => AES-256-GCM (POC) token encrypt/decrypt

middlewares/rawBody.js => raw body capture for signature verification

প্রয়োজনীয়তাসমূহ (prerequisites)

Docker & Docker Compose (local development)

Node/npm (optional, যদি নিজে লোকালি নন-ডকার চালাতে চান)

.env ফাইল — .env.example থেকে কপি করে ভরুন

MASTER_KEY: কমপক্ষে 32 বাইট (POC এ টোকেন এনক্রিপশনের জন্য)

APP_SECRET: Meta App secret (webhook signature verify-এর জন্য, বিকল্প)

VERIFY_TOKEN: Meta webhook verification token (GET verifier)

MONGO_URI, REDIS_HOST, REDIS_PORT, WHATSAPP_API_VERSION, PORT

.env সেটআপ

রুটে .env ফাইল তৈরি করুন (নিচেরগুলো অন্তর্ভুক্ত করুন — .env.example দেখুন)

APP_SECRET=<your_meta_app_secret>

VERIFY_TOKEN=<local_verify_token>

MASTER_KEY=<32_or_more_chars_secret>

MONGO_URI=mongodb://mongo:27017/pocdb

REDIS_HOST=redis

REDIS_PORT=6379

WHATSAPP_API_VERSION=v20.0

PORT=3000

ডেভেলপমেন্ট চালানো (Docker)

প্রথমবার build ও start:
docker-compose up --build

সার্ভিসগুলো রেডি হলে:

API: http://localhost:3000

Mongo Express (ঐচ্ছিক UI): http://localhost:8081
(user: admin / pass: pass)

Mongo: container নাম mongo (app container থেকে MONGO_URI ব্যবহার করুন)

Redis: container নাম redis

লাইভ-এডিট ও রিস্টার্টিং

nodemon কনফিগের মাধ্যমে src/ ডিরেক্টরির পরিবর্তনগুলো দেখবে এবং অটোমেটিক সার্ভার রিস্টার্ট করবে।

কোড আপডেট হলে container logs দেখার জন্য:
docker-compose logs -f app
docker-compose logs -f worker

যদি নতুন npm ডিপেন্ডেন্সি যোগ করেন:
docker-compose build app worker
(কেননা node_modules image-এ ইন্সটল করা থাকে)

বেসিক API (PoC)

Register tenant (PoC onboarding — tokens manually provided)
POST http://localhost:3000/tenants/register

Headers:
Content-Type: application/json
Body example:
{
"name": "Tenant A",
"phoneNumberId": "111111111111111",
"accessToken": "mock_token_tenant_A"
}

Send message (enqueue)
POST http://localhost:3000/tenants/
<TENANT_ID>/send
Body example:
{
"to": "+919xxxxxxxxx",
"text": "Hello from tenant A",
"idempotency_key": "order-1234" // optional
}

Webhook verification (Meta)
GET http://localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=
<VERIFY_TOKEN>&hub.challenge=<challenge>
(App responds with challenge when token matches VERIFY_TOKEN)

Webhook events (WhatsApp will POST here)
POST http://localhost:3000/whatsapp/webhook

Ensure signature header X-Hub-Signature-256 is included if APP_SECRET is set.
PoC accepts simulated POSTs for testing.

PoC টেস্টিং (curl উদাহরণ)

Register tenant:
curl -X POST http://localhost:3000/tenants/register

-H "Content-Type: application/json"
-d '{"name":"Tenant A","phoneNumberId":"111111111111111","accessToken":"mock_token_tenant_A"}'

Send message:
curl -X POST http://localhost:3000/tenants/
<TENANT_ID>/send
-H "Content-Type: application/json"
-d '{"to":"+919xxxxxxxxx","text":"Hello from tenant A", "idempotency_key":"order-1234"}'

Simulate incoming webhook (no signature header if APP_SECRET not set):
curl -X POST http://localhost:3000/whatsapp/webhook

-H "Content-Type: application/json"
-d '{
"entry":[
{
"changes":[
{
"value":{
"metadata":{"phone_number_id":"111111111111111"},
"messages":[{"from":"+919111111111","id":"wamid.123","type":"text","text":{"body":"hi"}}]
}
}
]
}
]
}'

বিস্তারিত কাজের নোটস (বরণীয়)

Tokens:

PoC-এ টেন্যান্ট accessToken .env না রেখে DB-তে AES-256-GCM দিয়ে এনক্রিপ্ট করে রাখা হয়।

Production-এ ব্যবহার করুন KMS (AWS KMS / GCP KMS) বা Secrets Manager; সবসময় token rotation বিবেচনা করুন.

Webhook signature:

যদি APP_SECRET সেট করা থাকে, তখন webhook POST verification অনিবার्य। X-Hub-Signature-256 হেডার যাচাই করা হয়।

PoC তে যদি APP_SECRET না দেয়া থাকে তাহলে verification skip করে (warning log করে) — production এ কখনোই skip করবেন না।

Idempotency:

Message collection-এ tenantId + idempotencyKey এর উপর partial unique index আছে; race-condition বা duplicate request suppressed।

enqueue করার আগে pre-check করা হয়; race হলে duplicate key exception ধরেই suppressed করা হয়।

Worker / Queue:

BullMQ ব্যবহার করে whatsapp-send-queue তৈরি করা আছে; job attempts: 5, exponential backoff।

Worker একটি আলাদা container/process হিসেবে রান করে (dev-compose-এ আলাদা service) — production-এ আলাদা স্কেল করুন।

Token যদি mock\_ দিয়ে শুরু করে, worker send action simulate করে (useful for local dev without hitting Graph API).

Scaling & production considerations (সংক্ষিপ্ত):

Separate worker autoscaling, DLQ (dead-letter queue) policy, monitoring/metrics (Prometheus), centralized logging (ELK / Loki), per-tenant rate-limiting, secure KMS-backed secrets, HTTPS endpoints, ingress/egress egress policies.

Onboarding UX: PoC accepts accessToken manually. Production-এ integrate Meta Embedded Signup / OAuth flow so tenants don’t paste tokens.

ডিবাগিং/ট্রাবলশুটিং

যদি Mongo যোগ না হয়: container logs দেখুন
docker-compose logs -f mongo

অ্যাপ লগ:
docker-compose logs -f app

worker লগ:
docker-compose logs -f worker

nodemon বারবার রিস্টার্ট করলে permission/volume সমস্যা থাকতে পারে — নিশ্চিত করুন host node_modules কন্টেইনারে mount করা নেই বা rebuild করে দেখুন:
docker-compose build app worker

পরবর্তী ধাপ (প্রস্তাব)

Embedded Signup flow যোগ করা (tenant OAuth / Meta flow) — আমি এর কোড যোগ করে দিতে পারি।

KMS-backed token encryption (AWS KMS / GCP KMS) integration।

Production Dockerfile, Kubernetes manifests, Helm chart এবং CI/CD pipeline (build/test/deploy).

Observability: metrics endpoints + Grafana dashboard template।
