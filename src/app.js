// express app wiring
import express from "express";
import dotenv from "dotenv";
import { rawBodyMiddleware } from "./middlewares/rawBody.js";
import { router as webhookRouter } from "./webhook.js";
import { enqueueSend } from "./sendController.js";
import { registerTenant } from "./tenantService.js";

dotenv.config();

const app = express();

// capture raw body for webhook signature verification
app.use(express.json({ verify: rawBodyMiddleware }));

// Routes
app.post("/tenants/register", async (req, res) => {
    try {
        const { name, phoneNumberId, accessToken, wabaId } = req.body;
        if (!name || !phoneNumberId || !accessToken) {
            return res.status(400).json({ error: "name, phoneNumberId and accessToken are required (POC)" });
        }
        const t = await registerTenant({ name, phoneNumberId, accessToken, wabaId });
        return res.json({ ok: true, tenant: { id: t._id, name: t.name, phoneNumberId: t.phoneNumberId } });
    } catch (err) {
        // log full error for server logs
        console.error("register error", err);

        // duplicate key (unique phoneNumberId) -> handled explicitly
        if (err && err.code === 11000) {
            return res.status(409).json({ error: "phoneNumberId already registered" });
        }

        // In development return error message + stack to help debugging.
        // In production do not expose stack trace.
        if (process.env.NODE_ENV === "development") {
            const safeMessage = err && err.message ? String(err.message) : "unknown error";
            return res.status(500).json({ error: safeMessage, stack: err.stack });
        }

        return res.status(500).json({ error: "internal" });
    }
});

// webhook mount
app.use("/whatsapp/webhook", webhookRouter);

// outbound send
app.post("/tenants/:tenantId/send", enqueueSend);

// health
app.get("/health", (req, res) => res.json({ ok: true }));

export default app;
