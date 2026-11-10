import { useNavigate } from "react-router-dom";
import type { Claim } from "../near/types";
import { AccountLink, Countdown, MatchBar, StatusBadge } from "./bits";
import { ago, nsToMs } from "../format";
import { shareIntent } from "../share";
import { useNow } from "../hooks";

export function ClaimCard({ claim }: { claim: Claim }) {
  const nav = useNavigate();
  const now = useNow(5000);
  const expired = nsToMs(claim.deadline) <= now;
  return (
    <article
      className={`card claim-card st-${claim.status.toLowerCase()}`}
      onClick={() => nav(`/claim/${claim.id}`)}
      data-testid={`claim-card-${claim.id}`}
    >
      <header className="card-top">
        <StatusBadge status={claim.status} expired={expired} />
        <span className="muted mono">#{claim.id}</span>
      </header>
      <p className="claim-text">“{claim.text}”</p>
      <div className="byline">
        <AccountLink id={claim.caller} handle={claim.x_handle} />
        <span className="muted">· {ago(nsToMs(claim.created_at))}</span>
      </div>
      <MatchBar claim={claim} />
      <footer className="card-foot">
        {claim.status === "Open" ? <Countdown deadline={claim.deadline} /> : <span className="muted">{claim.fades.length} fader{claim.fades.length === 1 ? "" : "s"}</span>}
        <a className="btn btn-ghost btn-sm" href={shareIntent(claim)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          Share on 𝕏
        </a>
      </footer>
    </article>
  );
}
