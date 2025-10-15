import { Worker, QueueScheduler, JobsOptions, Job } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { Message, Tenant } from "./models";
import { getAccessToken } from "./tenantService";
import type { SendJobData } from "./sendController";

const connection = new IORedis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
});

new QueueScheduler("whatsapp-send-queue", { connection });

export function startWorker(): void {
    const worker = new Worker<SendJobData>(
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
                const maybeResp = (err as unknown as { response?: { data?: unknown } }).response?.data;
                console.error("send job failed", maybeResp ?? (err as Error).message);
                msg.status = "failed";
                await msg.save();
                throw err; // let BullMQ retry
            }
        },
        { connection }
    );

    worker.on("failed", (job, err) => {
        console.error("Job failed", job.id, err.message);
    });

    console.log("Worker started");
}
