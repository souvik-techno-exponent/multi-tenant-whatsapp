import dotenv from "dotenv";
dotenv.config();
import { connectWithRetry } from "./db";
import { Tenant, Template, Flow } from "./models";

async function run(): Promise<void> {
    await connectWithRetry();

    // Pick a tenant to seed:
    // 1) TENANT_ID env, else 2) first tenant in DB
    const tenantId = process.env.SEED_TENANT_ID ?? (await Tenant.findOne().lean().exec())?._id?.toString();
    if (!tenantId) {
        console.error("No tenant found. Create a tenant first via /tenants/register or set SEED_TENANT_ID.");
        process.exit(2);
    }
    console.log("Seeding for tenant:", tenantId);

    // Upsert templates
    const templates = [
        {
            key: "greeting",
            body: "Hi {{name}} 👋, welcome to {{brand}}!",
            variables: ["name", "brand"],
            description: "Generic greeting"
        },
        {
            key: "help_menu",
            body: "You can reply: order, status, support",
            variables: []
        },
        {
            key: "order_intent",
            body: "Great! Please share your product code.",
            variables: []
        },
        {
            key: "status_intent",
            body: "Please share your order id to check status.",
            variables: []
        },
        {
            key: "fallback",
            body: "Sorry, I didn't get that. Type 'help' to see options.",
            variables: []
        }
    ];

    for (const t of templates) {
        await Template.findOneAndUpdate(
            { tenantId, key: t.key },
            {
                $set: {
                    body: t.body,
                    variables: t.variables ?? [],
                    description: t.description,
                    isActive: true,
                },
                $inc: { version: 1 },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).exec();
    }

    // Upsert flow
    const flowDoc = await Flow.findOneAndUpdate(
        { tenantId },
        {
            rules: [
                { when: { type: "contains", value: "hi" }, action: { replyTemplateKey: "greeting", setState: "welcomed" } },
                { when: { type: "contains", value: "help" }, action: { replyTemplateKey: "help_menu" } },
                { when: { type: "regex", value: "\\border\\b" }, action: { replyTemplateKey: "order_intent", setState: "awaiting_product_code" } },
                { when: { type: "regex", value: "\\bstatus\\b" }, action: { replyTemplateKey: "status_intent", setState: "awaiting_order_id" } }
            ],
            fallbackTemplateKey: "fallback"
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).exec();

    console.log("Seed complete. Flow id:", flowDoc?._id?.toString());
    process.exit(0);
}

run().catch((err) => {
    console.error("Seed error", err);
    process.exit(1);
});
