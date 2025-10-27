import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { rawBodyMiddleware } from "./middlewares/rawBody";
import { router as webhookRouter } from "./webhook";
import { enqueueSend } from "./sendController";
import { registerTenant, RegisterTenantInput } from "./tenantService";
import { upsertTemplate, listTemplates, getTemplate, renderTemplate } from "./templateService";
import { Flow } from "./models";
import { Types } from "mongoose";

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


// Create/Update a template for a tenant
app.post("/tenants/:tenantId/templates", async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    if (!Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({ error: "invalid tenantId" });
    }
    const { key, body, variables, description, isActive } = req.body || {};
    if (!key || !body) return res.status(400).json({ error: "key and body required" });
    try {
        const doc = await upsertTemplate({ tenantId, key, body, variables, description, isActive });
        return res.json({ ok: true, template: { id: doc._id, key: doc.key, version: doc.version } });
    } catch (err) {
        console.error("templates route error", err);
        return res.status(500).json({ error: "internal" });
    }
});

// List active templates
app.get("/tenants/:tenantId/templates", async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const items = await listTemplates(tenantId);
    return res.json({ ok: true, items });
});

// Send using a template (server-side render then reuse enqueueSend pipeline)
app.post("/tenants/:tenantId/send/template", async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const { to, templateKey, variables, idempotency_key } = req.body || {};
    if (!to || !templateKey) return res.status(400).json({ error: "to and templateKey required" });
    const t = await getTemplate(tenantId, templateKey);
    if (!t) return res.status(404).json({ error: "template not found" });
    // Render to plain text, then forward to existing /send controller
    req.body.text = renderTemplate(t.body, variables);
    req.body.idempotency_key = idempotency_key;
    return enqueueSend(req as any, res);
});

// Set/Get flow per-tenant
app.post("/tenants/:tenantId/flows", async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    if (!Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({ error: "invalid tenantId" });
    }
    const { rules, fallbackTemplateKey } = req.body || {};
    try {
        const doc = await Flow.findOneAndUpdate(
            { tenantId },
            { rules: Array.isArray(rules) ? rules : [], fallbackTemplateKey },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean().exec();
        return res.json({ ok: true, flow: doc });
    } catch (err) {
        console.error("flows route error", err);
        return res.status(500).json({ error: "internal" });
    }
});


app.get("/tenants/:tenantId/flows", async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const doc = await Flow.findOne({ tenantId }).lean().exec();
    return res.json({ ok: true, flow: doc });
});

app.use("/whatsapp/webhook", webhookRouter);

app.post("/tenants/:tenantId/send", enqueueSend);

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.use("*", (_req: Request, res: Response) => res.status(501).json({ msg: 'This api is not implemented' }))

export default app;
