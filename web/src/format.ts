const YOCTO = 10n ** 24n;

export function parseNear(input: string): bigint {
  const s = input.trim();
  if (!/^\d*(\.\d{0,24})?$/.test(s) || s === "" || s === ".") throw new Error("Enter a NEAR amount like 0.5");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export function formatNear(yocto: string | bigint, digits = 3): string {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto || "0");
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / YOCTO;
  const frac = (a % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

export const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

export function shortAccount(a: string, max = 22): string {
  if (a.length <= max) return a;
  if (/^[0-9a-f]{64}$/.test(a)) return `${a.slice(0, 6)}…${a.slice(-4)}`;
  return a.slice(0, max - 1) + "…";
}

export function timeLeft(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Fades close once 3/4 of the time from posting to the deadline has passed (same rule as the contract). */
export function fadesCloseMs(c: { created_at: string; deadline: string }): number {
  const start = BigInt(c.created_at), end = BigInt(c.deadline);
  return Number((start + ((end - start) / 4n) * 3n) / 1_000_000n);
}

const DAO_RE = /\.(sputnikv2\.testnet|sputnik-dao\.near)$/;
/** Sputnik DAO accounts (created by the sputnikv2 / sputnik-dao factory). */
export const isDao = (a: string) => DAO_RE.test(a);
