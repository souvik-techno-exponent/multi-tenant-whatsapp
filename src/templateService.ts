import { Template, TemplateDoc } from "./models";
import { FilterQuery } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export interface UpsertTemplateInput {
    tenantId: string;
    key?: string;
    body: string;
    variables?: string[];
    description?: string;
    isActive?: boolean;
    kind?: "text" | "interactive_button";
    buttons?: {
        id: string;
        title: string;
        nextTemplateKey?: string;
        nextState?: string;
    }[];
}

function extractVarsFromBody(s: string): string[] {
    const re = /{{\s*([\w.-]+)\s*}}/g;
    const set = new Set<string>();
    for (const m of s.matchAll(re)) {
        if (m[1]) set.add(m[1]);
    }
    return Array.from(set);
}


export async function upsertTemplate(input: UpsertTemplateInput): Promise<TemplateDoc> {
    const { tenantId, body, variables, description, isActive } = input;
    const key = (input.key && input.key.trim()) || `tmpl_${uuidv4().slice(0, 8)}`;
    const inferred = variables ?? extractVarsFromBody(body);
    const update = {
        $set: {
            body,
            variables: inferred,
            description,
            isActive: isActive ?? true,
            kind: input.kind ?? "text",
            buttons: input.buttons ?? [],
        },
        $inc: { version: 1 },
    };

    const doc = await Template.findOneAndUpdate(
        { tenantId, key } as FilterQuery<TemplateDoc>,
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<TemplateDoc>().exec();

    if (!doc) throw new Error("Failed to upsert template");
    return doc;
}

export async function listTemplates(tenantId: string): Promise<TemplateDoc[]> {
    return Template.find({ tenantId, isActive: true }).sort({ key: 1 }).lean<TemplateDoc[]>().exec();
}

export async function getTemplate(tenantId: string, key: string): Promise<TemplateDoc | null> {
    return Template.findOne({ tenantId, key, isActive: true }).lean<TemplateDoc>().exec();
}

export function renderTemplate(body: string, variables?: Record<string, string>): string {
    // very simple mustache-like {{var}} replace
    if (!variables) return body;
    return body.replace(/{{\s*([\w.-]+)\s*}}/g, (_m, g1) => {
        const v = variables[g1];
        return (v ?? "");
    });
}
