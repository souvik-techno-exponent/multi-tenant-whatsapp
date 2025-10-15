import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { rawBodyMiddleware } from "./middlewares/rawBody";
import { router as webhookRouter } from "./webhook";
import { enqueueSend } from "./sendController";
import { registerTenant, RegisterTenantInput } from "./tenantService";

dotenv.config();

const app = express();

app.use(express.json({ verify: rawBodyMiddleware }));

app.post("/tenants/register", async (req: Request<unknown, unknown, RegisterTenantInput>, res: Response) => {
    try {
        const { name, phoneNumberId, accessToken, wabaId } = req.body;
        if (!name || !phoneNumberId || !accessToken) {
            return res.status(400).json({ error: "name, phoneNumberId and accessToken are required (POC)" });
        }
        const t = await registerTenant({ name, phoneNumberId, accessToken, wabaId });
        return res.json({ ok: true, tenant: { id: t._id, name: t.name, phoneNumberId: t.phoneNumberId } });
    } catch (err) {
        console.error("register error", err);

        if ((err as { code?: number }).code === 11000) {
            return res.status(409).json({ error: "phoneNumberId already registered" });
        }

        if (process.env.NODE_ENV === "development") {
            const safeMessage = (err as Error).message ?? "unknown error";
            return res.status(500).json({ error: safeMessage, stack: (err as Error).stack });
        }

        return res.status(500).json({ error: "internal" });
    }
});

app.use("/whatsapp/webhook", webhookRouter);

app.post("/tenants/:tenantId/send", enqueueSend);

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

export default app;
