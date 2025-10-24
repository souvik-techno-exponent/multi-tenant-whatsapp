import { renderTemplate } from "./templateService";
import { MatchType, toMatchType } from "./conversation/types";
import { Flow, ConversationState, Template, FlowDocStrict } from "./models";

export async function handleInbound(opts: {
    tenantId: string;
    fromWaId: string;   // E.164 of customer
    text?: string | null;
}): Promise<{ replyText?: string } | null> {
    const { tenantId, fromWaId, text } = opts;
    const flow = await Flow.findOne({ tenantId }).lean<FlowDocStrict>().exec();
    if (!flow) return null;
    const msg = (text ?? "").trim();

    // Ensure a state doc exists
    const stateDoc = await ConversationState.findOneAndUpdate(
        { tenantId, customerWaId: fromWaId },
        { $setOnInsert: { state: "default" } },
        { upsert: true, new: true }
    ).exec();

    // Iterate flow rules in order
    for (const r of flow.rules ?? []) {
        // be defensive even though FlowDocStrict marks them required
        const type = toMatchType((r as any)?.when?.type as string | undefined);
        const value = r?.when?.value ?? "";
        let matched = false;
        if (!value) continue;
        if (type === MatchType.Contains) {
            matched = !!msg && msg.toLowerCase().includes(value.toLowerCase());
        } else if (type === MatchType.Regex) {
            try {
                const re = new RegExp(value, "i");
                matched = re.test(msg);
            } catch {
                // ignore bad regex
            }
        }
        if (!matched) continue;

        const tKey = r?.action?.replyTemplateKey;
        if (!tKey) continue;
        const t = await Template.findOne({ tenantId, key: tKey, isActive: true }).lean().exec();
        if (!t) continue;

        // Minimal example: no context vars yet; you can derive vars from msg/state later.
        const replyText = renderTemplate(t.body);

        // Optional state transition
        if (r?.action?.setState) {
            stateDoc.state = r.action.setState;
            await stateDoc.save();
        }
        return { replyText };
    }

    // fallback
    if (flow.fallbackTemplateKey) {
        const ft = await Template.findOne({ tenantId, key: flow.fallbackTemplateKey, isActive: true }).lean().exec();
        if (ft) return { replyText: renderTemplate(ft.body) };
    }
    return null;
}
