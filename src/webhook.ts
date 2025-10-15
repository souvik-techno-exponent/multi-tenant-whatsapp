import express, { Request, Response } from "express";
import crypto from "crypto";
import { getTenantByPhoneNumberId } from "./tenantService";
import { Customer, Message } from "./models";

const APP_SECRET = process.env.APP_SECRET ?? "";

export const router = express.Router();

router.get("/", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(String(challenge ?? ""));
    }
    return res.sendStatus(403);
});

// Minimal types for webhook payload structure we care about
interface WebhookMessage {
    from: string;
    id: string;
    type?: string;
    text?: { body?: string };
}

interface WebhookStatus {
    id: string;
    status?: string;
}

interface WebhookValue {
    metadata?: { phone_number_id?: string };
    messages?: WebhookMessage[];
    statuses?: WebhookStatus[];
}

interface WebhookBody {
    entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }>;
}

router.post("/", async (req: Request<unknown, unknown, WebhookBody>, res: Response) => {
    try {
        const sig = req.get("x-hub-signature-256") ?? "";
        if (APP_SECRET) {
            const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody ?? Buffer.from("")).digest("hex");
            const sigBuf = Buffer.from(sig);
            const expBuf = Buffer.from(expected);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                console.warn("Invalid signature on webhook");
                return res.sendStatus(401);
            }
        } else {
            console.warn("APP_SECRET not set; skipping signature verification (POC)");
        }

        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!phoneNumberId) return res.sendStatus(200);

        const tenant = await getTenantByPhoneNumberId(phoneNumberId);
        if (!tenant) {
            console.warn("No tenant for phone number id:", phoneNumberId);
            return res.sendStatus(200);
        }

        const messages = value?.messages ?? [];
        for (const m of messages) {
            const from = m.from;
            const text = m.text?.body ?? null;

            await Customer.findOneAndUpdate(
                { tenantId: tenant._id, waId: from },
                { $set: { lastSeenAt: new Date() } },
                { upsert: true, new: true }
            ).exec();

            await Message.create({
                tenantId: tenant._id,
                direction: "IN",
                body: text,
                type: m.type ?? "text",
                waMessageId: m.id,
                status: "received"
            });
        }

        const statuses = value?.statuses ?? [];
        for (const s of statuses) {
            await Message.updateMany({ tenantId: tenant._id, waMessageId: s.id }, { $set: { status: s.status } }).exec();
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error("webhook error", err);
        return res.sendStatus(500);
    }
});
