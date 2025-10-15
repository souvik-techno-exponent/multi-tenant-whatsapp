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
        const sig = (req.get("x-hub-signature-256") || "").trim();
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

        /* for now we are taking only 1st element, bt ideally we should check all elements with looping */
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




/* 
example payload format: MULTI-TENANT + MULTI-USER in single payload
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "whatsapp_business_account_1",
      "changes": [
        {
          "value": {
            "metadata": { "phone_number_id": "PNID_TENANT_A" },
            "messages": [
              {
                "from": "+919100000001",
                "id": "wamid.A.1",
                "type": "text",
                "text": { "body": "Hi Tenant A!" }
              },
              {
                "from": "+919100000002",
                "id": "wamid.A.2",
                "type": "image",
                "image": { "id": "MEDIA_A_1", "caption": "photo" }
              }
            ]
          }
        },
        {
          "value": {
            "metadata": { "phone_number_id": "PNID_TENANT_B" },
            "messages": [
              {
                "from": "+919200000001",
                "id": "wamid.B.1",
                "type": "text",
                "text": { "body": "Order question" }
              }
            ],
            "statuses": [
              {
                "id": "wamid.OUT_B_100",
                "status": "delivered",
                "recipient_id": "+919200000001"
              }
            ]
          }
        }
      ]
    },
    {
      "id": "whatsapp_business_account_2",
      "changes": [
        {
          "value": {
            "metadata": { "phone_number_id": "PNID_TENANT_A" },
            "messages": [
              {
                "from": "+919100000003",
                "id": "wamid.A.3",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": { "id": "btn_yes", "title": "Yes" }
                }
              }
            ]
          }
        }
      ]
    }
  ]
}

*/