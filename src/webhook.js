// Webhook router with verification and tenant routing
import express from "express";
import crypto from "crypto";
import { getTenantByPhoneNumberId } from "./tenantService.js";
import { Customer, Message } from "./models.js";

const APP_SECRET = process.env.APP_SECRET || "";

export const router = express.Router();

// GET verification - Meta webhook setup
router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// POST events
router.post("/", async (req, res) => {
    try {
        // signature verification
        const sig = req.get("x-hub-signature-256") || "";
        if (APP_SECRET) {
            const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
            const sigBuf = Buffer.from(sig);
            const expBuf = Buffer.from(expected);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                console.warn("Invalid signature on webhook");
                return res.sendStatus(401);
            }
        } else {
            console.warn("APP_SECRET not set; skipping signature verification (POC)");
        }

        const body = req.body;
        const entry = body?.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!phoneNumberId) return res.sendStatus(200);

        const tenant = await getTenantByPhoneNumberId(phoneNumberId);
        if (!tenant) {
            console.warn("No tenant for phone number id:", phoneNumberId);
            return res.sendStatus(200);
        }

        // Persist inbound messages
        const messages = value?.messages || [];
        for (const m of messages) {
            const from = m.from;
            const text = m.text?.body ?? null;

            // Upsert customer for tenant
            await Customer.findOneAndUpdate({ tenantId: tenant._id, waId: from }, { $set: { lastSeenAt: new Date() } }, { upsert: true, new: true });

            // Create message record
            await Message.create({
                tenantId: tenant._id,
                direction: "IN",
                body: text,
                type: m.type ?? "text",
                waMessageId: m.id,
                status: "received",
            });

            // Optionally trigger reply/workflow here (left as exercise)
        }

        // Update statuses (delivery receipts)
        const statuses = value?.statuses || [];
        for (const s of statuses) {
            await Message.updateMany({ tenantId: tenant._id, waMessageId: s.id }, { $set: { status: s.status } });
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error("webhook error", err);
        return res.sendStatus(500);
    }
});
