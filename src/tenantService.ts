import { Tenant, TenantDoc } from "./models";
import { encrypt, decrypt } from "./utils/crypto";

export interface RegisterTenantInput {
    name: string;
    phoneNumberId: string;
    accessToken: string;
    wabaId?: string;
}

export async function registerTenant(input: RegisterTenantInput): Promise<TenantDoc> {
    const { name, phoneNumberId, accessToken, wabaId } = input;
    const accessTokenEnc = encrypt(accessToken);
    const t = new Tenant({
        name,
        phoneNumberId,
        wabaId,
        accessTokenEnc
    });
    await t.save();
    return t.toObject() as TenantDoc;
}

export async function getTenantByPhoneNumberId(pnid: string): Promise<TenantDoc | null> {
    return Tenant.findOne({ phoneNumberId: pnid }).lean<TenantDoc>().exec();
}

export async function getTenantById(id: string): Promise<TenantDoc | null> {
    return Tenant.findById(id).lean<TenantDoc>().exec();
}

export function getAccessToken(tenant: Pick<TenantDoc, "accessTokenEnc"> | null): string | null {
    if (!tenant) return null;
    return decrypt(tenant.accessTokenEnc);
}
