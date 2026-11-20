import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
function key() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Account recovery is not configured.");
  return createHash("sha256")
    .update("caedm-assisted-recovery:v1:")
    .update(secret)
    .digest();
}
export function sealRecoveryToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function openRecoveryToken(sealed: string) {
  const [version, iv, tag, body, extra] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra || sealed.length > 2048)
    throw new Error("Invalid recovery capability.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  const token = Buffer.concat([
    cipher.update(Buffer.from(body, "base64url")),
    cipher.final(),
  ]).toString("utf8");
  if (!/^[a-f0-9]{32,128}$/.test(token))
    throw new Error("Invalid recovery capability.");
  return token;
}
