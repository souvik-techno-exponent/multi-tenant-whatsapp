// src/worker.ts
// Worker process for processing send jobs (BullMQ).
// Approach: pass plain connection options object to BullMQ (maxRetriesPerRequest: null).
// This avoids bullmq's runtime check and is robust across environments.
//
// Notes:
// - We use a namespace import and a small require-fallback to be robust with ESM/CJS interop.
// - We deliberately avoid creating an ioredis client here; bullmq will create its own client
//   from the options we provide (recommended for this use-case).

import * as BullMQ from "bullmq";
import type { Job } from "bullmq";
import axios from "axios";
import { Message, Tenant } from "./models";
import { getAccessToken } from "./tenantService";

// Job payload shape
export type SendJobData = {
    tenantId: string;
    messageId: string;
    to: string;
    text: string;
    idempotencyKey?: string;
};

// Interop-safe access to QueueScheduler and Worker constructors.
// Cast namespace to any to silence TS complaining about missing props,
// and provide a require fallback for certain runtime setups.
const _Bull: any = BullMQ;
let QueueSchedulerCtor = _Bull.QueueScheduler;
let WorkerCtor = _Bull.Worker;

if (!QueueSchedulerCtor || !WorkerCtor) {
    // fallback to require (handles some CJS/ESM environments)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const required = require("bullmq");
    QueueSchedulerCtor = QueueSchedulerCtor ?? required.QueueScheduler;
    WorkerCtor = WorkerCtor ?? required.Worker;
}

if (!QueueSchedulerCtor || !WorkerCtor) {
    console.error("Could not locate QueueScheduler or Worker constructors from bullmq. Check 'bullmq' installation/version.");
    // we do not throw here — startWorker will check and abort if necessary
}

// --- Connection options object (Option A) ---
// IMPORTANT: bullmq requires maxRetriesPerRequest === null
const connectionOptions = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    // when using Redis URL, prefer `connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null }`
    // but leaving host/port is fine for dev docker compose setups
    maxRetriesPerRequest: null as null
};

// instantiate QueueScheduler (so delayed jobs, retries, etc. work)
if (QueueSchedulerCtor) {
    try {
        // QueueScheduler accepts connection options object
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const qs = new QueueSchedulerCtor("whatsapp-send-queue", { connection: connectionOptions });
        // We don't need to hold reference to qs for this PoC
    } catch (err) {
        console.error("Failed to create QueueScheduler:", (err as Error).message);
    }
} else {
    console.warn("QueueSchedulerCtor not available — scheduler not started.");
}

// Worker starter
export function startWorker(): void {
    if (!WorkerCtor) {
        console.error("Worker constructor not found on bullmq import. Aborting worker start.");
        return;
    }

    const worker = new WorkerCtor(
        "whatsapp-send-queue",
        // processor
        async (job: Job<SendJobData>) => {
            const { tenantId, messageId, to, text } = job.data;

            // Load tenant
            const tenant = await Tenant.findById(tenantId).exec();
            if (!tenant) throw new Error("tenant not found");

            // Decrypt token
            const token = getAccessToken(tenant);
            if (!token) throw new Error("tenant missing access token");

            // Load message
            const msg = await Message.findById(messageId).exec();
            if (!msg) throw new Error("message not found");

            // Idempotency: skip if already sent
            if (msg.status === "sent") {
                return { ok: true, note: "already-sent" };
            }

            const version = process.env.WHATSAPP_API_VERSION || "v20.0";
            const phoneNumberId = tenant.phoneNumberId;
            const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

            try {
                // Dev-mode: simulate if token starts with "mock_"
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
                // rethrow so BullMQ can handle retries/backoff
                throw err;
            }
        },
        // options
        {
            connection: connectionOptions,
            // You can also tune concurrency here, e.g. concurrency: 5
            // concurrency: 5
        }
    );

    worker.on("failed", (job: Job, err: Error) => {
        console.error("Job failed", job.id, err?.message);
    });

    worker.on("completed", (job: Job) => {
        console.log("Job completed", job.id);
    });

    console.log("Worker started");
}
