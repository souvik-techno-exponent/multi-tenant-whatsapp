// Tenant helper functions
import { Tenant } from "./models.js";
import { encrypt, decrypt } from "./utils/crypto.js";

/**
 * registerTenant - PoC onboarding (accepts token manually for now)
 */
export async function registerTenant({ name, phoneNumberId, accessToken, wabaId }) {
    const accessTokenEnc = encrypt(accessToken);
    const t = new Tenant({
        name,
        phoneNumberId,
        wabaId,
        accessTokenEnc,
    });
    await t.save();
    return t.toObject();
}

export async function getTenantByPhoneNumberId(pnid) {
    return Tenant.findOne({ phoneNumberId: pnid }).lean();
}

export async function getTenantById(id) {
    return Tenant.findById(id).lean();
}

export function getAccessToken(tenant) {
    if (!tenant) return null;
    return decrypt(tenant.accessTokenEnc);
}
