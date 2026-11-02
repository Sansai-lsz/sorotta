import { describe, expect, it } from "vitest";
import { verifySignature } from "./verify.ts";

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedRequest(body: string) {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const timestamp = "1700000000";
  const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
  const publicKey = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  return { publicKeyHex: toHex(publicKey), signatureHex: toHex(signature), timestamp };
}

describe("verifySignature", () => {
  it("正しい署名を受け入れる", async () => {
    const { publicKeyHex, signatureHex, timestamp } = await signedRequest('{"type":1}');
    expect(await verifySignature(publicKeyHex, signatureHex, timestamp, '{"type":1}')).toBe(true);
  });

  it("本文が改ざんされていれば拒否する", async () => {
    const { publicKeyHex, signatureHex, timestamp } = await signedRequest('{"type":1}');
    expect(await verifySignature(publicKeyHex, signatureHex, timestamp, '{"type":2}')).toBe(false);
  });

  it("16 進数でない署名は拒否する", async () => {
    const { publicKeyHex, timestamp } = await signedRequest("{}");
    expect(await verifySignature(publicKeyHex, "zz", timestamp, "{}")).toBe(false);
  });
});
