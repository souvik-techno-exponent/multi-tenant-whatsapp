import { FilterQuery } from "mongoose";
import { Template, TemplateDoc } from "./models";

export interface UpsertTemplateInput {
    tenantId: string;
    key: string;
    body: string;
    variables?: string[];
    description?: string;
    isActive?: boolean;
}

export async function upsertTemplate(input: UpsertTemplateInput): Promise<TemplateDoc> {
    const { tenantId, key, body, variables, description, isActive } = input;
    const update = {
        body,
        variables: variables ?? [],
        description,
        isActive: isActive ?? true,
        $inc: { version: 1 }
    } as any;
    const doc = await Template.findOneAndUpdate(
        { tenantId, key } as FilterQuery<TemplateDoc>,
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<TemplateDoc>().exec();
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
