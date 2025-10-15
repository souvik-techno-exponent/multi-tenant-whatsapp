// AES-256-GCM encrypt/decrypt for token at-rest (POC).
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const MASTER_KEY = process.env.MASTER_KEY || "";

if (!MASTER_KEY || MASTER_KEY.length < 32) {
    console.warn("MASTER_KEY not set or <32 bytes. Tokens will not be securely encrypted.");
}

export function encrypt(text) {
    if (!MASTER_KEY) return text;
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(MASTER_KEY).slice(0, 32);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(enc) {
    if (!MASTER_KEY) return enc;
    const data = Buffer.from(enc, "base64");
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const text = data.slice(28);
    const key = Buffer.from(MASTER_KEY).slice(0, 32);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(text), decipher.final()]);
    return decrypted.toString("utf8");
}
