// src/worker.ts
// Robust worker using bullmq with ESM/CJS interop safe pattern.
// We cast bullmq namespace to any to avoid build-time type mismatch issues.

import * as BullMQ from "bullmq";
import type { Job } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { Message, Tenant } from "./models";
import { getAccessToken } from "./tenantService";

type SendJobData = {
    tenantId: string;
    messageId: string;
    to: string;
    text: string;
    idempotencyKey?: string;
};

const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
});

// --- Interop-safe access to classes ---
// cast to any to avoid TypeScript/runtime interop issues
const _Bull: any = BullMQ;
let QueueScheduler = _Bull.QueueScheduler;
let WorkerCtor = _Bull.Worker;

if (!QueueScheduler) {
    // As a fallback try named import (edge cases)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const required = require("bullmq");
    // @ts-ignore
    QueueScheduler = required.QueueScheduler;
    // @ts-ignore
    WorkerCtor = required.Worker;
}

if (!QueueScheduler) {
    console.error("QueueScheduler not found on bullmq import. Please check bullmq version.");
    // We won't throw here; worker will fail later when started if necessary
} else {
    // instantiate scheduler so delayed/retries etc work
    new QueueScheduler("whatsapp-send-queue", { connection });
}

export function startWorker(): void {
    if (!WorkerCtor) {
        console.error("Worker constructor not found on bullmq import. Aborting worker start.");
        return;
    }

    const worker = new WorkerCtor(
        "whatsapp-send-queue",
        async (job: Job<SendJobData>) => {
            const { tenantId, messageId, to, text } = job.data;

            const tenant = await Tenant.findById(tenantId).exec();
            if (!tenant) throw new Error("tenant not found");

            const token = getAccessToken(tenant);
            if (!token) throw new Error("tenant missing access token");

            const msg = await Message.findById(messageId).exec();
            if (!msg) throw new Error("message not found");
            if (msg.status === "sent") {
                return { ok: true, note: "already-sent" };
            }

            const version = process.env.WHATSAPP_API_VERSION || "v20.0";
            const phoneNumberId = tenant.phoneNumberId;
            const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

            try {
                // dev-mode simulation when token starts with "mock_"
                if (token.startsWith("mock_")) {
                    msg.status = "sent";
                    msg.waMessageId = `mock-${Date.now()}`;
                    await msg.save();
                    return { ok: true, simulated: true };
                }

                const payload = {
                    messaging_product: "whatsapp",
                    to,
                    type: "text" as const,
                    text: { body: text }
                };

                const resp = await axios.post(url, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 10000
                });

                const waMessageId: string | null = resp.data?.messages?.[0]?.id ?? null;
                msg.status = "sent";
                if (waMessageId) msg.waMessageId = waMessageId;
                await msg.save();

                return { ok: true, waMessageId };
            } catch (err) {
                const maybeResp = (err as any)?.response?.data;
                console.error("send job failed", maybeResp ?? (err as Error).message);
                msg.status = "failed";
                await msg.save();
                throw err; // let BullMQ retry
            }
        },
        { connection }
    );

    worker.on("failed", (job: Job, err: Error) => {
        console.error("Job failed", job.id, err?.message);
    });

    console.log("Worker started");
}
