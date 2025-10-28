// src/conversationEngine.ts

import { renderTemplate } from "./templateService";
import { MatchType, toMatchType } from "./conversation/types";
import { Flow, ConversationState, Template } from "./models";

/**
 * Describes one rule inside the tenant flow document.
 * Matches incoming message (equals / contains / regex),
 * and triggers a reply template + optional state change.
 */
interface FlowRule {
    when?: {
        type?: string;   // "equals" | "contains" | "regex"
        value?: string;  // the pattern or text to match
    };
    action?: {
        replyTemplateKey?: string; // which template to send
        setState?: string;         // optional new conversation state
    };
}

/**
 * Shape of Flow document we care about.
 */
interface FlowDoc {
    rules?: FlowRule[];
    fallbackTemplateKey?: string;
}

/**
 * Buttons we might send back to WhatsApp in an interactive message.
 */
interface OutButton {
    id: string;
    title: string;
}

/**
 * What the engine returns to the webhook so it can enqueue a send job.
 */
export interface InboundDecision {
    replyKind?: "text" | "interactive_button";
    replyText?: string;
    buttons?: OutButton[];
}

/**
 * Handle inbound WA messages with optional button payload.
 * Priority:
 *   1. If payloadId exists, branch based on lastTemplateKey + chosen button.
 *   2. Else run keyword/regex flow rules.
 *   3. Else fallbackTemplateKey.
 */
export async function handleInboundAdvanced(opts: {
    tenantId: string;
    fromWaId: string;          // user's WhatsApp number (customer waId)
    text?: string | null;      // free text or button title
    payloadId?: string | null; // button payload id from WhatsApp interactive reply
}): Promise<InboundDecision | null> {
    const { tenantId, fromWaId, text, payloadId } = opts;

    // ensure we have a conversation state doc
    const stateDoc = await ConversationState.findOneAndUpdate(
        { tenantId, customerWaId: fromWaId },
        { $setOnInsert: { state: "default" } },
        { upsert: true, new: true }
    ).exec();

    //
    // 1. BUTTON BRANCH HANDLING
    //
    if (payloadId) {
        const lastKey = stateDoc.lastTemplateKey;
        if (lastKey) {
            const prevTmpl = await Template.findOne({
                tenantId,
                key: lastKey,
                isActive: true
            })
                .lean()
                .exec();

            if (prevTmpl && prevTmpl.kind === "interactive_button") {
                // find which button was clicked
                const chosenButton = (prevTmpl.buttons ?? []).find(
                    (b) => b.id === payloadId
                );

                if (chosenButton && chosenButton.nextTemplateKey) {
                    const nextTmpl = await Template.findOne({
                        tenantId,
                        key: chosenButton.nextTemplateKey,
                        isActive: true
                    })
                        .lean()
                        .exec();

                    if (nextTmpl) {
                        // optional state transition
                        if (chosenButton.nextState) {
                            stateDoc.state = chosenButton.nextState;
                        }

                        // remember which template we just sent
                        stateDoc.lastTemplateKey = nextTmpl.key;
                        await stateDoc.save();

                        if (nextTmpl.kind === "interactive_button") {
                            return {
                                replyKind: "interactive_button",
                                replyText: renderTemplate(nextTmpl.body),
                                buttons: (nextTmpl.buttons ?? []).map(
                                    (b: { id: string; title: string }) => ({
                                        id: b.id,
                                        title: b.title,
                                    })
                                ),
                            };
                        }

                        // normal text response
                        return {
                            replyKind: "text",
                            replyText: renderTemplate(nextTmpl.body),
                        };
                    }
                }
            }
        }
        // if payloadId didn't map, fall through to normal flow
    }

    //
    // 2. KEYWORD / REGEX FLOW
    //
    const flowDoc = await Flow.findOne({ tenantId }).lean<FlowDoc>().exec();
    const incomingMsg = (text ?? "").trim();

    if (flowDoc) {
        const rules: FlowRule[] = flowDoc.rules ?? [];

        for (const rule of rules) {
            const matchType: MatchType = toMatchType(rule.when?.type);
            const matchValue: string = rule.when?.value ?? "";

            if (!matchValue) {
                continue;
            }

            let matched = false;

            if (matchType === MatchType.Contains) {
                matched =
                    incomingMsg.length > 0 &&
                    incomingMsg
                        .toLowerCase()
                        .includes(matchValue.toLowerCase());
            } else if (matchType === MatchType.Regex) {
                try {
                    const re = new RegExp(matchValue, "i");
                    matched = re.test(incomingMsg);
                } catch {
                    // bad regex -> treat as no match
                    matched = false;
                }
            } else {
                // Equals (default)
                matched =
                    incomingMsg.toLowerCase() === matchValue.toLowerCase();
            }

            if (!matched) {
                continue;
            }

            // rule matched
            const templateKey = rule.action?.replyTemplateKey;
            if (!templateKey) {
                continue;
            }

            const tmpl = await Template.findOne({
                tenantId,
                key: templateKey,
                isActive: true
            })
                .lean()
                .exec();

            if (!tmpl) {
                continue;
            }

            // optional state transition from rule
            if (rule.action?.setState) {
                stateDoc.state = rule.action.setState;
            }

            // track last template for future button clicks
            stateDoc.lastTemplateKey = tmpl.key;
            await stateDoc.save();

            if (tmpl.kind === "interactive_button") {
                return {
                    replyKind: "interactive_button",
                    replyText: renderTemplate(tmpl.body),
                    buttons: (tmpl.buttons ?? []).map(
                        (b: { id: string; title: string }) => ({
                            id: b.id,
                            title: b.title,
                        })
                    ),
                };
            }

            return {
                replyKind: "text",
                replyText: renderTemplate(tmpl.body),
            };
        }

        //
        // 3. FALLBACK
        //
        if (flowDoc.fallbackTemplateKey) {
            const fbTmpl = await Template.findOne({
                tenantId,
                key: flowDoc.fallbackTemplateKey,
                isActive: true
            })
                .lean()
                .exec();

            if (fbTmpl) {
                stateDoc.lastTemplateKey = fbTmpl.key;
                await stateDoc.save();

                if (fbTmpl.kind === "interactive_button") {
                    return {
                        replyKind: "interactive_button",
                        replyText: renderTemplate(fbTmpl.body),
                        buttons: (fbTmpl.buttons ?? []).map(
                            (b: { id: string; title: string }) => ({
                                id: b.id,
                                title: b.title,
                            })
                        ),
                    };
                }

                return {
                    replyKind: "text",
                    replyText: renderTemplate(fbTmpl.body),
                };
            }
        }
    }

    // no reply
    return null;
}
