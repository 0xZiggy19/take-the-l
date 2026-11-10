import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../near/rpc";
import { usePoll, useNow } from "../hooks";
import { useWallet, cleanError } from "../near/wallet";
import { useToast } from "../components/Toast";
import { AccountLink, Countdown, MatchBar, Near, Spinner, StatusBadge } from "../components/bits";
import { formatNear, nsToMs, parseNear, ago } from "../format";
import { shareIntent } from "../share";
import { CONTRACT_ID, EXPLORER } from "../config";
import type { Claim } from "../near/types";

export default function ClaimPage() {
  const id = Number(useParams().id);
  const { accountId } = useWallet();
  const { data: claim, error, reload } = usePoll(() => api.getClaim(id), [id], 4000);
  const { data: claimable, reload: reloadClaimable } = usePoll(
    () => (accountId ? api.claimable(id, accountId) : Promise.resolve("0")), [id, accountId], 4000);
  const now = useNow();

  if (error) return <div className="error">Couldn't load call #{id}: {error}</div>;
  if (claim === undefined) return <Spinner />;
  if (claim === null) return <div className="empty">Call #{id} doesn't exist. <Link to="/">Back to the feed</Link></div>;

  const expired = nsToMs(claim.deadline) <= now;
  const refresh = () => { reload(); reloadClaimable(); };

  return (
    <section className="claim-page">
      <Link to="/" className="back">← feed</Link>
      <div className={`card claim-hero st-${claim.status.toLowerCase()}`}>
        <header className="card-top">
          <StatusBadge status={claim.status} expired={expired} />
          <span className="muted mono">call #{claim.id}</span>
        </header>
        <p className="claim-text big" data-testid="claim-text">“{claim.text}”</p>
        <div className="byline">
          <AccountLink id={claim.caller} handle={claim.x_handle} />
          <span className="muted">· posted {ago(nsToMs(claim.created_at))}</span>
          {claim.x_link && <a href={claim.x_link} target="_blank" rel="noreferrer" className="muted">· original post ↗</a>}
        </div>
        <MatchBar claim={claim} />
        <div className="meta-row">
          {claim.status === "Open" ? <Countdown deadline={claim.deadline} /> : (
            <span className="muted">Settled {claim.resolved_at && ago(nsToMs(claim.resolved_at))}{claim.resolved_by && claim.resolved_by !== claim.caller && <> by <AccountLink id={claim.resolved_by} /></>}</span>
          )}
          <span className="muted">deadline {new Date(nsToMs(claim.deadline)).toLocaleString()}</span>
        </div>
        <Verdict claim={claim} />
        <div className="share-row">
          <a className="btn btn-x" href={shareIntent(claim)} target="_blank" rel="noreferrer" data-testid="btn-share">Share on 𝕏</a>
          <a className="btn btn-ghost" href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">Contract ↗</a>
        </div>
      </div>

      <Actions claim={claim} expired={expired} claimable={claimable ?? "0"} onDone={refresh} />

      <div className="card">
        <h3>Faders ({claim.fades.length})</h3>
        {claim.fades.length === 0 ? <p className="muted">Nobody has faded this call yet.</p> : (
          <ul className="faders">
            {claim.fades.map((f) => (
              <li key={f.fader}>
                <AccountLink id={f.fader} />
                <span><b className="c-fade"><Near y={f.amount} /></b>{claim.status !== "Open" && claim.status !== "Won" && <span className="muted"> → wins <Near y={BigInt(f.amount) * 2n} />{f.paid ? " ✓ collected" : ""}</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Verdict({ claim }: { claim: Claim }) {
  const S = BigInt(claim.stake), F = BigInt(claim.total_faded);
  if (claim.status === "Won") return <div className="verdict v-w" data-testid="verdict">W. The caller took <Near y={S + F} />.</div>;
  if (claim.status === "Lost") return <div className="verdict v-l" data-testid="verdict">L taken. Faders split <Near y={F * 2n} />.</div>;
  if (claim.status === "Ghosted") return <div className="verdict v-ghost" data-testid="verdict">GHOSTED. The caller went quiet, so it counts as an L.</div>;
  return null;
}

function Actions({ claim, expired, claimable, onDone }: { claim: Claim; expired: boolean; claimable: string; onDone: () => void }) {
  const { accountId, signIn, call } = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("0.5");
  const isCaller = accountId === claim.caller;
  const remaining = BigInt(claim.stake) - BigInt(claim.total_faded);

  async function run(label: string, method: string, args: object, deposit?: bigint, okText?: string) {
    setBusy(label);
    try {
      const res = await call(method, args, deposit);
      toast({ kind: "ok", text: okText ?? "Done", hash: res.hash });
      onDone();
    } catch (e) {
      toast({ kind: "err", text: cleanError(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!accountId) {
    if (claim.status !== "Open" && !expired) return null;
    return (
      <div className="card actions">
        <p>{claim.status === "Open" ? "Think it's cap? Connect a wallet to fade it." : "Connect to collect winnings or settle this call."}</p>
        <button className="btn btn-primary" onClick={signIn} data-testid="btn-connect-inline">Connect wallet</button>
      </div>
    );
  }

  const claimableBig = BigInt(claimable || "0");
  const parts: React.ReactNode[] = [];

  if (claim.status === "Open" && !expired) {
    if (isCaller) {
      parts.push(
        <div key="resolve" className="resolve">
          <p>It's your call. Settle it honestly, because everyone can see your record.</p>
          <div className="resolve-btns">
            <button className="btn btn-w btn-lg" disabled={!!busy} data-testid="btn-resolve-w"
              onClick={() => run("W", "resolve", { claim_id: claim.id, outcome: "W" }, 0n, "W locked in. Payout sent.")}>
              {busy === "W" ? "…" : "I called it: W"}
            </button>
            <button className="btn btn-l btn-lg" disabled={!!busy} data-testid="btn-resolve-l"
              onClick={() => run("L", "resolve", { claim_id: claim.id, outcome: "L" }, 0n, "Respect. L taken.")}>
              {busy === "L" ? "…" : "I take the L"}
            </button>
          </div>
        </div>,
      );
    } else if (remaining > 0n) {
      let dep: bigint | null = null;
      try { dep = parseNear(amount); } catch { dep = null; }
      parts.push(
        <form key="fade" className="fade-form" onSubmit={(e) => {
          e.preventDefault();
          if (dep) run("fade", "fade", { claim_id: claim.id }, dep, "Faded. Now you wait.");
        }}>
          <p>Fade this call. If the caller takes the L, you get <b>2×</b> your fade. If they hit, you lose it. You can fade up to <b className="c-fade"><Near y={remaining} /></b>, and anything over that is refunded.</p>
          <div className="chips">
            {["0.1", "0.5", "1"].map((s) => (
              <button type="button" key={s} className={`chip ${amount === s ? "chip-on" : ""}`} onClick={() => setAmount(s)}>{s} Ⓝ</button>
            ))}
            <button type="button" className="chip" onClick={() => setAmount(formatNear(remaining + 10n ** 22n, 4))}>max</button>
            <input className="chip-input" data-testid="in-fade" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button className="btn btn-fade btn-lg" disabled={!dep || !!busy} data-testid="btn-fade">
            {busy === "fade" ? "Signing…" : `Fade it for ${dep ? formatNear(dep) : "–"} Ⓝ`}
          </button>
        </form>,
      );
    } else {
      parts.push(<p key="full" className="muted">This call is fully faded. Now we wait for the verdict.</p>);
    }
  }

  if (claim.status === "Open" && expired) {
    parts.push(
      <div key="timeout" className="timeout">
        <p><b className="c-ghost">The deadline passed and the caller never settled.</b> Anyone can settle it now. It counts as an L and the caller gets marked as ghosted.</p>
        <button className="btn btn-ghostly btn-lg" disabled={!!busy} data-testid="btn-timeout"
          onClick={() => run("timeout", "resolve_timeout", { claim_id: claim.id }, 0n, "Settled as GHOSTED 👻")}>
          {busy === "timeout" ? "…" : "Settle as GHOSTED 👻"}
        </button>
      </div>,
    );
  }

  if (claim.status !== "Open" && claimableBig > 0n) {
    parts.push(
      <div key="collect" className="collect">
        <p>You have <b className="c-w" data-testid="claimable"><Near y={claimableBig} /></b> to collect.</p>
        <button className="btn btn-w btn-lg" disabled={!!busy} data-testid="btn-collect"
          onClick={() => run("collect", "collect", { claim_id: claim.id }, 0n, "Collected. Enjoy.")}>
          {busy === "collect" ? "…" : `Collect ${formatNear(claimableBig)} Ⓝ`}
        </button>
      </div>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="card actions" data-testid="actions">{parts}</div>;
}
