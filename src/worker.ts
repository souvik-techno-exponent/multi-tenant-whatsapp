// src/worker.ts
//
// BullMQ worker that actually sends WhatsApp messages out.
// This consumes jobs from the "whatsapp-send-queue" queue.
// Each job tells us:
//   - which tenant to use (so we know which WA Business number + token)
//   - which DB Message we're sending
//   - what kind of content to send ("text" or "interactive_button")
//
// Flow:
//   1. Decrypt tenant's WA access token
//   2. Build WhatsApp Cloud API payload
//   3. POST to WhatsApp Graph API
//   4. Mark Message doc as "sent" (or "failed" if it throws)
//
// NOTE: startWorker() should be called once from a separate process
// e.g. src/workerProcess.ts

import * as BullMQ from "bullmq";
import type { Job } from "bullmq";
import axios from "axios";
import { Message, Tenant } from "./models";
import { getAccessToken } from "./tenantService";

// This MUST match what webhook.ts enqueues.
export interface SendJobData {
    tenantId: string;
    messageId: string;
    to: string;
    content: {
        kind: "text" | "interactive_button";
        text?: string;
        buttons?: { id: string; title: string }[];
    };
    idempotencyKey?: string;
}

// Grab BullMQ constructors in a way that works for both ESM/CJS builds.
const _Bull: any = BullMQ;
let QueueSchedulerCtor = _Bull.QueueScheduler;
let WorkerCtor = _Bull.Worker;

if (!QueueSchedulerCtor || !WorkerCtor) {
    // Some runtimes need require() fallback to access constructors
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required = require("bullmq");
    QueueSchedulerCtor = QueueSchedulerCtor ?? required.QueueScheduler;
    WorkerCtor = WorkerCtor ?? required.Worker;
}

if (!QueueSchedulerCtor || !WorkerCtor) {
    console.error(
        "Could not locate QueueScheduler or Worker constructors from bullmq. Check 'bullmq' install/version."
    );
    // we won't throw here; startWorker() below will guard WorkerCtor again
}

// Redis connection options for BullMQ worker + scheduler.
const connectionOptions = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    // typical BullMQ/ioredis recommendation in worker context
    maxRetriesPerRequest: null as null,
};

// We create a QueueScheduler so BullMQ can handle retries / backoff, etc.
if (QueueSchedulerCtor) {
    try {
        // We don't use `qs` later; just constructing it is enough.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const qs = new QueueSchedulerCtor("whatsapp-send-queue", {
            connection: connectionOptions,
        });
    } catch (err) {
        console.error(
            "Failed to create QueueScheduler:",
            (err as Error).message
        );
    }
} else {
    console.warn(
        "QueueSchedulerCtor not available — scheduler not started."
    );
}

/**
 * startWorker()
 *
 * Call this from the dedicated worker process (not the web server).
 * Example:
 *   import { startWorker } from "./worker";
 *   startWorker();
 */
export function startWorker(): void {
    if (!WorkerCtor) {
        console.error(
            "Worker constructor not found on bullmq import. Aborting worker start."
        );
        return;
    }

    const worker = new WorkerCtor(
        "whatsapp-send-queue",
        async (job: Job<SendJobData>) => {
            const { tenantId, messageId, to, content } = job.data;

            //
            // 1. Load tenant + decrypt WA token
            //
            const tenant = await Tenant.findById(tenantId).exec();
            if (!tenant) {
                throw new Error("tenant not found");
            }

            // getAccessToken() should unwrap/decrypt tenant.accessTokenEnc
            const token = getAccessToken(tenant);
            if (!token) {
                throw new Error("tenant missing access token");
            }

            //
            // 2. Load the outbound Message we're supposed to send
            //
            const msg = await Message.findById(messageId).exec();
            if (!msg) {
                throw new Error("message not found");
            }

            // If we've already marked it "sent", don't send again
            if (msg.status === "sent") {
                return { ok: true, note: "already-sent" };
            }

            //
            // 3. Build WhatsApp Cloud API payload
            //
            const version = process.env.WHATSAPP_API_VERSION || "v20.0";
            const phoneNumberId = tenant.phoneNumberId;
            const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

            try {
                // Optional local-dev shortcut:
                // If token starts with "mock_", don't actually call WhatsApp.
                if (token.startsWith("mock_")) {
                    msg.status = "sent";
                    msg.waMessageId = `mock-${Date.now()}`;
                    await msg.save();
                    return { ok: true, simulated: true };
                }

                let payload: any;
                if (content.kind === "interactive_button") {
                    // Interactive button template
                    payload = {
                        messaging_product: "whatsapp",
                        to,
                        type: "interactive",
                        interactive: {
                            type: "button",
                            body: { text: content.text },
                            action: {
                                buttons: (content.buttons ?? []).map((b) => ({
                                    type: "reply",
                                    reply: {
                                        id: b.id,
                                        title: b.title,
                                    },
                                })),
                            },
                        },
                    };
                } else {
                    // Plain text fallback
                    payload = {
                        messaging_product: "whatsapp",
                        to,
                        type: "text",
                        text: { body: content.text },
                    };
                }

                //
                // 4. Call WhatsApp Cloud API
                //
                const resp = await axios.post(url, payload, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    timeout: 10_000,
                });

                const waMessageId: string | null =
                    resp.data?.messages?.[0]?.id ?? null;

                //
                // 5. Update DB status -> sent
                //
                msg.status = "sent";
                if (waMessageId) {
                    msg.waMessageId = waMessageId;
                }
                await msg.save();

                return { ok: true, waMessageId };
            } catch (err) {
                // Mark failed and rethrow so BullMQ retry/backoff can kick in
                const maybeResp = (err as any)?.response?.data;
                console.error(
                    "send job failed",
                    maybeResp ?? (err as Error).message
                );

                msg.status = "failed";
                await msg.save();

                throw err; // causes BullMQ to retry according to attempts/backoff
            }
        },
        {
            connection: connectionOptions,
            // concurrency: 5, // <-- optional parallelism
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
