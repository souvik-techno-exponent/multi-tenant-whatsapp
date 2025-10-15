// BullMQ worker that processes send jobs and calls WhatsApp Graph API
import { Worker, QueueScheduler } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { Message, Tenant } from "./models.js";
import { getAccessToken } from "./tenantService.js";

const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
});

// start scheduler for retries/backoff
new QueueScheduler("whatsapp-send-queue", { connection });

const worker = new Worker(
    "whatsapp-send-queue",
    async (job) => {
        const { tenantId, messageId, to, text, idempotencyKey } = job.data;

        // load tenant
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) throw new Error("tenant not found");

        const token = getAccessToken(tenant);
        if (!token) throw new Error("tenant missing access token");

        // idempotency check: if message has status 'sent' already then skip
        const msg = await Message.findById(messageId);
        if (!msg) throw new Error("message not found");
        if (msg.status === "sent") {
            return { ok: true, note: "already-sent" };
        }

        // Build Graph endpoint
        const version = process.env.WHATSAPP_API_VERSION || "v20.0";
        const phoneNumberId = tenant.phoneNumberId;
        const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

        try {
            // For PoC: simulate when token starts with "mock_"
            if (token.startsWith("mock_")) {
                msg.status = "sent";
                msg.waMessageId = `mock-${Date.now()}`;
                await msg.save();
                return { ok: true, simulated: true };
            }

            const payload = {
                messaging_product: "whatsapp",
                to,
                type: "text",
                text: { body: text },
            };

            const resp = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 10000,
            });

            const waMessageId = resp.data?.messages?.[0]?.id ?? null;
            msg.status = "sent";
            if (waMessageId) msg.waMessageId = waMessageId;
            await msg.save();

            return { ok: true, waMessageId };
        } catch (err) {
            console.error("send job failed", err?.response?.data ?? err.message);
            msg.status = "failed";
            await msg.save();
            throw err; // let BullMQ handle retries/backoff
        }
    },
    { connection }
);

worker.on("failed", (job, err) => {
    console.error("Job failed", job.id, err.message);
});
