import { env } from "../_generated/server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sourceKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`partyroom:source:${env.WORKER_SIGNING_SECRET}`),
  );
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSourceUrl(sourceUrl: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sourceKey(),
    encoder.encode(sourceUrl),
  );
  return { encryptedSource: toBase64Url(new Uint8Array(ciphertext)), sourceIv: toBase64Url(iv) };
}

export async function decryptSourceUrl(encryptedSource: string, sourceIv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(sourceIv) },
    await sourceKey(),
    fromBase64Url(encryptedSource),
  );
  return decoder.decode(plaintext);
}

export async function hashRequest(sourceUrl: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(sourceUrl));
  return toBase64Url(new Uint8Array(digest));
}
