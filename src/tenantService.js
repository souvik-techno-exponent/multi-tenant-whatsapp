// tenant helpers: register tenant, find tenant by phoneNumberId or id, get decrypted token
import { Tenant } from "./models.js";
import { encrypt, decrypt } from "./utils/crypto.js";

/**
 * registerTenant: simple onboarding for PoC.
 * In production use embedded signup flow; don't accept raw tokens manually.
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
    return t;
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
