/**
 * Log-injection hardening. Strings that originate outside the codebase —
 * filesystem names under the snapshot root, parsed meta/dump/expectation
 * values — can carry control characters (ANSI escapes, carriage returns,
 * newlines) that forge or erase lines in CLI output and evidence labels.
 *
 * Control characters are replaced with visible `\uXXXX` escapes rather than
 * deleted, so the evidence stays inspectable instead of silently mangled:
 * what was in the name is exactly what the operator sees.
 *
 * The transform is idempotent — sanitized text contains no control
 * characters, so re-sanitizing is a no-op. That makes it safe to apply at
 * both the parse layer (row construction) and the print layer (CLI output)
 * without double-escaping.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeForLog(input: string): string {
  return input.replace(CONTROL_CHARS, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
