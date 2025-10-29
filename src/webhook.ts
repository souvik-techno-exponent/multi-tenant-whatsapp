// src/webhook.ts
//
// Handles incoming WhatsApp webhook events.
// - GET /whatsapp/webhook  -> Meta verification (hub.challenge)
// - POST /whatsapp/webhook -> incoming messages, status updates
//
// Flow on inbound message:
//   1. Identify tenant by phone_number_id
//   2. Save inbound Message in DB
//   3. Run handleInboundAdvanced(...) to decide reply
//   4. Create outbound Message in DB
//   5. Enqueue a BullMQ job to actually send WhatsApp reply
//
// Replies can be plain text OR interactive button menus.
// Button clicks come back as interactive payloads, and we branch
// conversation state based on which button was pressed.

import express, { Request, Response } from "express";
import { Message, Tenant } from "./models";
import { handleInboundAdvanced } from "./conversationEngine";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const router = express.Router();

// ----------- WhatsApp inbound message typing / parsing -----------

interface InboundWAMessage {
  from?: string; // user's WhatsApp number (E.164)
  id?: string;
  type?: string;
  timestamp?: string;

  text?: {
    body?: string;
  };

  // legacy style button replies
  button?: {
    payload?: string;
    text?: string;
  };

  // interactive replies (recommended by WhatsApp Cloud API)
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: {
      id?: string; // stable payload id we configured
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
  };
}

/**
 * extractInboundContent()
 *
 * Normalizes different WhatsApp message formats into a consistent shape:
 * - textBody: what the user "said" / clicked label
 * - payloadId: which reply option was clicked (used for branching)
 */
function extractInboundContent(m: InboundWAMessage): {
  fromWaId: string | null;
  textBody: string | null;
  payloadId: string | null;
  waMessageId: string | null;
  messageType: string | null;
} {
  const fromWaId = m.from ?? null;
  const waMessageId = m.id ?? null;
  const messageType = m.type ?? null;

  // free text
  const textBodyRaw = m.text?.body ?? null;

  // legacy non-interactive buttons
  const legacyBtnPayload = m.button?.payload ?? null;
  const legacyBtnText = m.button?.text ?? null;

  // interactive button / list replies
  const interactivePayload =
    m.interactive?.button_reply?.id ??
    m.interactive?.list_reply?.id ??
    null;

  const interactiveTitle =
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    null;

  // payload the bot should branch on
  const payloadId = interactivePayload ?? legacyBtnPayload ?? null;

  // best-effort human-visible text for logging / transcript
  const textBody = interactiveTitle ?? legacyBtnText ?? textBodyRaw ?? null;

  return {
    fromWaId,
    textBody,
    payloadId,
    waMessageId,
    messageType,
  };
}

// ----------- BullMQ job payload that worker.ts will consume -----------

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

// Redis connection for queue producer
const connection = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  maxRetriesPerRequest: null,
});

// Producer queue (consumer lives in worker.ts / startWorker())
const sendQueue = new Queue<SendJobData>("whatsapp-send-queue", {
  connection,
});

// ---------------------------------------------------------
// GET /whatsapp/webhook
// Meta will call this once during setup to verify the token.
// ---------------------------------------------------------


router.get("/", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(String(challenge ?? ""));
  }
  return res.sendStatus(403);
});

// ---------------------------------------------------------
// POST /whatsapp/webhook
//
// Called every time we get:
//   - a new user message
//   - a button click
//   - a delivery/read status update
//
// This route:
//   - maps phone_number_id -> tenant
//   - persists inbound message
//   - asks conversationEngine what to reply
//   - enqueues outbound job for worker
//   - updates message status changes
// ---------------------------------------------------------
router.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    // The WhatsApp payload is shaped as entry[] -> changes[]
    const entryArr = Array.isArray(req.body?.entry) ? req.body.entry : [];

    for (const entry of entryArr) {
      const changeArr = Array.isArray(entry?.changes)
        ? entry.changes
        : [];

      for (const change of changeArr) {
        const value = change?.value;
        const phoneNumberId: string | undefined =
          value?.metadata?.phone_number_id;

        // inbound messages (user -> us)
        const messages: InboundWAMessage[] = Array.isArray(
          value?.messages
        )
          ? (value.messages as InboundWAMessage[])
          : [];

        // No tenant or no inbound messages? nothing to do.
        if (!phoneNumberId || messages.length === 0) {
          continue;
        }

        // Identify tenant by phone_number_id
        const tenantDoc = await Tenant.findOne({
          phoneNumberId,
        })
          .lean()
          .exec();

        if (!tenantDoc) {
          // Unknown number (not mapped to any tenant in DB)
          continue;
        }

        // Handle each message from that tenant
        for (const waMsg of messages) {
          try {
            const {
              fromWaId,
              textBody,
              payloadId,
              waMessageId,
              messageType,
            } = extractInboundContent(waMsg);

            if (!fromWaId) {
              continue;
            }

            // 1. Persist inbound message record
            const createdMsg = await Message.create({
              tenantId: tenantDoc._id,
              direction: "IN",
              body: textBody ?? payloadId ?? "",
              type: payloadId
                ? "button_reply"
                : (messageType ?? "text"),
              waMessageId,
              status: "received",
              createdAt: new Date(),
            });

            // 2. Run conversation logic (flows, branching buttons, etc.)
            const decision = await handleInboundAdvanced({
              tenantId: tenantDoc._id.toString(),
              fromWaId,
              text: textBody,
              payloadId,
            });

            // 3. If engine says "reply", enqueue it
            if (decision && decision.replyText) {
              // for retry safety: don't send twice for same inbound
              const idempotencyKey = `flow-reply:${waMessageId ?? createdMsg._id
                }`;

              // already sent a response for this inbound?
              const existingOut = await Message.findOne({
                tenantId: tenantDoc._id,
                idempotencyKey,
              })
                .lean()
                .exec();

              if (!existingOut) {
                // create outbound message document
                const outMsg = await Message.create({
                  tenantId: tenantDoc._id,
                  direction: "OUT",
                  body: decision.replyText,
                  type: decision.replyKind ?? "text",
                  idempotencyKey,
                  status: "queued",
                  createdAt: new Date(),
                });

                // actually enqueue for worker.ts -> WhatsApp API
                await sendQueue.add(
                  "send",
                  {
                    tenantId: tenantDoc._id.toString(),
                    messageId: outMsg._id.toString(),
                    to: fromWaId,
                    content: {
                      kind: decision.replyKind ?? "text",
                      text: decision.replyText,
                      buttons: decision.buttons,
                    },
                    idempotencyKey,
                  },
                  {
                    attempts: 5,
                    backoff: { type: "exponential", delay: 2000 },
                  }
                );
              }
            }
          } catch (err) {
            // Don't crash the whole webhook loop for one bad message
            console.error("Error processing inbound message", {
              phoneNumberId,
              err,
            });
          }
        }

        // 4. Delivery / read receipts from WhatsApp (statuses[])
        const statuses = Array.isArray(value?.statuses)
          ? value.statuses
          : [];

        if (statuses.length > 0) {
          for (const s of statuses as any[]) {
            try {
              const waId = s?.id;
              if (!waId) continue;

              await Message.updateMany(
                {
                  tenantId: tenantDoc._id,
                  waMessageId: waId,
                },
                {
                  $set: {
                    status: s.status ?? "unknown",
                  },
                }
              ).exec();
            } catch (err) {
              console.error(
                "Error updating message status for waMessageId",
                s?.id,
                err
              );
            }
          }
        }
      }
    }

    // Always 200 so Meta doesn't retry aggressively unless we truly blew up
    res.sendStatus(200);
  }
);

export default router;
