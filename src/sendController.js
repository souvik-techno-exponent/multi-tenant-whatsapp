// enqueue outbound message per-tenant (create DB message record + push BullMQ job)
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { Message, Tenant } from "./models.js";

const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
});

const sendQueue = new Queue("whatsapp-send-queue", { connection });

/**
 * POST /tenants/:tenantId/send
 * body: { to: "<E.164>", text: "message", idempotency_key?: "..." }
 */
export async function enqueueSend(req, res) {
    try {
        const tenantId = req.params.tenantId;
        const { to, text, idempotency_key } = req.body;

        if (!to || !text) return res.status(400).json({ error: "to and text required" });

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: "tenant not found" });

        const key = idempotency_key || uuidv4();

        // Pre-check idempotency: if message exists with same key for tenant, return it
        const existing = await Message.findOne({ tenantId: tenant._id, idempotencyKey: key }).lean();
        if (existing) {
            return res.status(200).json({ ok: true, idempotency_key: key, messageId: existing._id, note: "duplicate suppressed" });
        }

        // Create message record as queued
        const msgDoc = await Message.create({
            tenantId: tenant._id,
            direction: "OUT",
            body: text,
            type: "text",
            idempotencyKey: key,
            status: "queued",
        });

        // Enqueue job
        await sendQueue.add(
            "send",
            {
                tenantId: tenant._id.toString(),
                messageId: msgDoc._id.toString(),
                to,
                text,
                idempotencyKey: key,
            },
            {
                attempts: 5,
                backoff: { type: "exponential", delay: 2000 },
            }
        );

        return res.json({ ok: true, idempotency_key: key, messageId: msgDoc._id });
    } catch (err) {
        // If duplicate key error occurs due to race, return conflict suppressed
        if (err.code === 11000) {
            return res.status(200).json({ ok: true, note: "duplicate suppressed (race)" });
        }
        console.error("enqueueSend error", err);
        return res.status(500).json({ error: "internal" });
    }
}
