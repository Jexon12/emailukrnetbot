/**
 * Simple encryption for sensitive data (e.g. stored passwords).
 * Uses AES-256-GCM. Requires ENCRYPTION_KEY env var (32 bytes hex).
 * If key is not set, data is stored as-is (backward compatible).
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function getKey() {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) return null;
    try {
        return Buffer.from(hex, 'hex');
    } catch {
        return null;
    }
}

function encrypt(plain) {
    const key = getKey();
    if (!key || !plain) return plain;

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
        let enc = cipher.update(plain, 'utf8', 'hex');
        enc += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `enc:${iv.toString('hex')}:${tag}:${enc}`;
    } catch (e) {
        console.error('Encryption error:', e.message);
        return plain;
    }
}

function decrypt(encrypted) {
    const key = getKey();
    if (!key || !encrypted || !encrypted.startsWith('enc:')) return encrypted;

    try {
        const parts = encrypted.slice(4).split(':');
        if (parts.length !== 3) return encrypted;
        const [ivHex, tagHex, enc] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
        decipher.setAuthTag(tag);
        return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
    } catch (e) {
        console.error('Decryption error:', e.message);
        return encrypted;
    }
}

module.exports = { encrypt, decrypt, getKey };
