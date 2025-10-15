import { Request, Response } from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { Message, Tenant } from "./models";

const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
});

export interface SendJobData {
    tenantId: string;
    messageId: string;
    to: string;
    text: string;
    idempotencyKey: string;
}

const sendQueue = new Queue<SendJobData>("whatsapp-send-queue", { connection });

interface SendBody {
    to: string;
    text: string;
    idempotency_key?: string;
}

interface SendParams {
    tenantId: string;
}

export async function enqueueSend(req: Request<SendParams, unknown, SendBody>, res: Response): Promise<Response> {
    try {
        const { tenantId } = req.params;
        const { to, text, idempotency_key } = req.body;

        if (!to || !text) return res.status(400).json({ error: "to and text required" });

        const tenant = await Tenant.findById(tenantId).exec();
        if (!tenant) return res.status(404).json({ error: "tenant not found" });

        const key = idempotency_key ?? uuidv4();

        const existing = await Message.findOne({ tenantId: tenant._id, idempotencyKey: key }).lean().exec();
        if (existing) {
            return res.status(200).json({ ok: true, idempotency_key: key, messageId: existing._id, note: "duplicate suppressed" });
        }

        const msgDoc = await Message.create({
            tenantId: tenant._id,
            direction: "OUT",
            body: text,
            type: "text",
            idempotencyKey: key,
            status: "queued"
        });

        await sendQueue.add(
            "send",
            {
                tenantId: tenant._id.toString(),
                messageId: msgDoc._id.toString(),
                to,
                text,
                idempotencyKey: key
            },
            {
                attempts: 5,
                backoff: { type: "exponential", delay: 2000 }
            }
        );

        return res.json({ ok: true, idempotency_key: key, messageId: msgDoc._id });
    } catch (err) {
        // duplicate key race
        if ((err as { code?: number }).code === 11000) {
            return res.status(200).json({ ok: true, note: "duplicate suppressed (race)" });
        }
        console.error("enqueueSend error", err);
        return res.status(500).json({ error: "internal" });
    }
}
