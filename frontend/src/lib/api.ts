import axios from 'axios';

// Axios instance targeting Vite proxy (/api -> http://app:3000)
// This keeps browser calls same-origin to the dev server.
export const api = axios.create({
    baseURL: '/api',
    timeout: 10000
});

export type RegisterTenantBody = {
    name: string;
    phoneNumberId: string;
    accessToken: string;
    wabaId?: string;
};

// ---- Templates ----
export type TemplateItem = {
    _id: string;
    key: string;
    body: string;
    description?: string;
    variables?: string[];
    isActive: boolean;
    version: number;
    kind?: "text" | "interactive_button";
    buttons?: { id: string; title: string; nextTemplateKey?: string; nextState?: string }[];
};

export async function listTemplatesApi(tenantId: string) {
    const { data } = await api.get(`/tenants/${tenantId}/templates`);
    return data.items as TemplateItem[];
}

export async function upsertTemplateApi(
    tenantId: string,
    body: {
        key?: string;
        body: string;
        variables?: string[];
        description?: string;
        isActive?: boolean;
        kind?: "text" | "interactive_button";
        buttons?: { id: string; title: string; nextTemplateKey?: string; nextState?: string }[];
    }
) {
    const { data } = await api.post(`/tenants/${tenantId}/templates`, body);
    return data.template;
}

export async function sendTemplateApi(tenantId: string, payload: {
    to: string; templateKey: string; variables?: Record<string, string>; idempotency_key?: string;
}) {
    const { data } = await api.post(`/tenants/${tenantId}/send/template`, payload);
    return data;
}

// ---- Flows ----
export type FlowRule = {
    when: { type: "equals" | "contains" | "regex"; value: string };
    action: { replyTemplateKey: string; setState?: string };
};
export type FlowDoc = { _id?: string; rules: FlowRule[]; fallbackTemplateKey?: string };

export async function getFlowApi(tenantId: string) {
    const { data } = await api.get(`/tenants/${tenantId}/flows`);
    return (data.flow ?? { rules: [] }) as FlowDoc;
}
export async function saveFlowApi(tenantId: string, flow: FlowDoc) {
    const { data } = await api.post(`/tenants/${tenantId}/flows`, flow);
    return data.flow as FlowDoc;
}

export default api;
