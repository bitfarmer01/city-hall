import { createHash } from "node:crypto";

/** sha256 hex of the text/bytes — pins every capture to its exact content. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
