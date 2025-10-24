import express, { Request, Response } from "express";
import crypto from "crypto";
import { getTenantByPhoneNumberId } from "./tenantService";
import { Customer, Message } from "./models";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { handleInbound } from "./conversationEngine";

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
  // other fields (image, interactive, location, etc.) may exist
  [key: string]: any;
}

interface WebhookStatus {
  id: string;
  status?: string;
  [key: string]: any;
}

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
  [key: string]: any;
}

interface WebhookChange {
  value?: WebhookValue;
  [key: string]: any;
}

interface WebhookEntry {
  changes?: WebhookChange[];
  [key: string]: any;
}

interface WebhookBody {
  entry?: WebhookEntry[];
  [key: string]: any;
}

// --- send queue (same shape the worker expects) ---
interface SendJobData {
  tenantId: string;
  messageId: string;
  to: string;
  text: string;
  idempotencyKey?: string;
}
const connection = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379)
});
const sendQueue = new Queue<SendJobData>("whatsapp-send-queue", { connection });


router.post("/", async (req: Request<unknown, unknown, WebhookBody>, res: Response) => {
  try {
    // 1) Signature verification (if APP_SECRET configured)
    const sig = (req.get("x-hub-signature-256") || "").trim();
    if (APP_SECRET) {
      const raw = req.rawBody ?? Buffer.from("");
      const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expected);
      console.log({ expected, sig }, '======================')
      /*  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
         console.warn("Invalid signature on webhook");
         return res.sendStatus(401);
       } */

    } else {
      console.warn("APP_SECRET not set; skipping signature verification (POC)");
    }

    // 2) Validate body
    const body = req.body as WebhookBody;
    if (!body?.entry || !Array.isArray(body.entry) || body.entry.length === 0) {
      // nothing to do
      return res.sendStatus(200);
    }

    // 3) Iterate all entries and changes (supports multi-tenant + multi-user in one payload)
    for (const entry of body.entry) {
      if (!entry?.changes || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const value = change?.value as WebhookValue | undefined;
        if (!value) continue;

        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) {
          console.warn("webhook change without phone_number_id metadata, skipping");
          continue;
        }

        // Resolve tenant by phone_number_id
        let tenant;
        try {
          tenant = await getTenantByPhoneNumberId(phoneNumberId);
        } catch (err) {
          console.error("error fetching tenant for phoneNumberId", phoneNumberId, err);
          // Skip this change (do not block other changes)
          continue;
        }

        if (!tenant) {
          console.warn("No tenant for phone number id:", phoneNumberId);
          // Optionally: persist raw event to 'unmapped' collection for later manual mapping
          continue;
        }

        // Process messages array (could be multiple messages from multiple users)
        const messages = value?.messages ?? [];
        if (Array.isArray(messages) && messages.length > 0) {
          // process messages in parallel per-change but catch errors per-item
          await Promise.all(messages.map(async (m: WebhookMessage) => {
            try {
              const from = m.from;
              const text = m.text?.body ?? null;
              // NOTE: "from" = customer's WhatsApp number (E.164)

              // Upsert customer (atomic single-doc upsert)
              await Customer.findOneAndUpdate(
                { tenantId: tenant._id, waId: from },
                { $set: { lastSeenAt: new Date() } },
                { upsert: true, new: true }
              ).exec();

              // Deduplicate inbound by waMessageId (avoid double-insert on retries)
              if (m.id) {
                const exists = await Message.findOne({ tenantId: tenant._id, waMessageId: m.id }).exec();
                if (exists) {
                  // Optionally update status/timestamps if needed
                  // console.info("Inbound message already exists, skipping:", m.id);
                  return;
                }
              }

              // Create inbound message record
              await Message.create({
                tenantId: tenant._id,
                direction: "IN",
                body: text,
                type: m.type ?? "text",
                waMessageId: m.id,
                status: "received",
                createdAt: new Date()
              });
              // === Flow engine: decide auto-reply by per-tenant rules/templates ===
              const decision = await handleInbound({ tenantId: tenant._id.toString(), fromWaId: from, text });
              if (decision?.replyText) {
                const idempotencyKey = `flow-reply:${m.id}`;
                const existing = await Message.findOne({ tenantId: tenant._id, idempotencyKey }).lean().exec();
                if (!existing) {
                  const outMsg = await Message.create({
                    tenantId: tenant._id,
                    direction: "OUT",
                    body: decision.replyText,
                    type: "text",
                    idempotencyKey,
                    status: "queued"
                  });
                  await sendQueue.add(
                    "send",
                    {
                      tenantId: tenant._id.toString(),
                      messageId: outMsg._id.toString(),
                      to: from,
                      text: decision.replyText,
                      idempotencyKey
                    },
                    { attempts: 5, backoff: { type: "exponential", delay: 2000 } }
                  );
                }
              }


              // === NEW: Auto-reply to customer on behalf of tenant ===
              // Compose reply
              const replyText = `thanks for reaching us\n- team ${tenant.name}\n- By heart from Souvik`;
              // Create outbound queued message (idempotent per inbound-id)
              const idempotencyKey = `auto-reply:${m.id}`;
              const existing = await Message.findOne({ tenantId: tenant._id, idempotencyKey }).lean().exec();
              if (!existing) {
                const outMsg = await Message.create({
                  tenantId: tenant._id,
                  direction: "OUT",
                  body: replyText,
                  type: "text",
                  idempotencyKey,
                  status: "queued"
                });
                // Enqueue for worker to send
                await sendQueue.add(
                  "send",
                  {
                    tenantId: tenant._id.toString(),
                    messageId: outMsg._id.toString(),
                    to: from,
                    text: replyText,
                    idempotencyKey
                  },
                  { attempts: 5, backoff: { type: "exponential", delay: 2000 } }
                );
              }

            } catch (err) {
              // log per-message errors but don't fail entire webhook processing
              console.error("Error processing inbound message", { phoneNumberId, messageId: m?.id, err });
            }
          }));
        }

        // Process statuses (delivery/read receipts)
        const statuses = value?.statuses ?? [];
        if (Array.isArray(statuses) && statuses.length > 0) {
          for (const s of statuses) {
            try {
              if (!s?.id) continue;
              // Update any message(s) with this waMessageId for this tenant
              await Message.updateMany(
                { tenantId: tenant._id, waMessageId: s.id },
                { $set: { status: s.status ?? "unknown" } }
              ).exec();
            } catch (err) {
              console.error("Error updating status for waMessageId", s?.id, err);
            }
          }
        }

        // end processing this change
      } // end for change
    } // end for entry

    // 4) Return success quickly
    return res.sendStatus(200);
  } catch (err) {
    console.error("webhook error", err);
    return res.sendStatus(500);
  }
});
