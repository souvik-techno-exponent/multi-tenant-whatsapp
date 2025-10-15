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
        console.error("register error", err);
        if (err.code === 11000) return res.status(409).json({ error: "phoneNumberId already registered" });
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
