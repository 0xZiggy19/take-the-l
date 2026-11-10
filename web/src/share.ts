import type { Claim } from "./near/types";
import { formatNear } from "./format";

export function claimUrl(id: number): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/claim/${id}`;
}

export function shareText(c: Claim): string {
  const who = c.x_handle ? `@${c.x_handle}` : c.caller;
  const pot = formatNear(BigInt(c.stake) + BigInt(c.total_faded));
  switch (c.status) {
    case "Open":
      return `${who} put ${formatNear(c.stake)} NEAR on it: "${c.text}"\n\nThink it's cap? Fade it 👇`;
    case "Won":
      return `${who} called it ✅ "${c.text}"\n\nW secured: ${pot} NEAR paid out on-chain.`;
    case "Lost":
      return `${who} took the L 🫡 "${c.text}"\n\nFaders got paid. On-chain, forever.`;
    case "Ghosted":
      return `${who} ghosted their own call 👻 "${c.text}"\n\nSettled as an L. Faders got paid.`;
  }
}

export function shareIntent(c: Claim): string {
  const text = `${shareText(c)}\n\n#NEARHackathon @NEARProtocol`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(claimUrl(c.id))}`;
}
