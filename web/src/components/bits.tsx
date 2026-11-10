import { Link } from "react-router-dom";
import type { Claim, Status } from "../near/types";
import { formatNear, nsToMs, shortAccount, timeLeft } from "../format";
import { useNow } from "../hooks";

export const STATUS_LABEL: Record<Status, string> = { Open: "LIVE", Won: "W", Lost: "L", Ghosted: "GHOSTED" };

export function StatusBadge({ status, expired }: { status: Status; expired?: boolean }) {
  if (status === "Open" && expired) return <span className="badge badge-expired">AWAITING SETTLEMENT</span>;
  return <span className={`badge badge-${status.toLowerCase()}`} data-testid="status">{status === "Open" && <i className="dot" />}{STATUS_LABEL[status]}</span>;
}

export function Countdown({ deadline }: { deadline: string }) {
  const now = useNow();
  const left = nsToMs(deadline) - now;
  if (left <= 0) return <span className="countdown done">deadline passed</span>;
  return <span className={`countdown ${left < 60_000 ? "urgent" : ""}`} data-testid="countdown">⏱ {timeLeft(left)}</span>;
}

export function AccountLink({ id, handle }: { id: string; handle?: string | null }) {
  return (
    <Link to={`/u/${id}`} className="acct" onClick={(e) => e.stopPropagation()}>
      {handle ? <><b>@{handle}</b> <span className="muted">{shortAccount(id, 18)}</span></> : <b>{shortAccount(id)}</b>}
    </Link>
  );
}

export function MatchBar({ claim }: { claim: Claim }) {
  const stake = BigInt(claim.stake);
  const faded = BigInt(claim.total_faded);
  const pct = stake > 0n ? Number((faded * 1000n) / stake) / 10 : 0;
  return (
    <div className="match">
      <div className="match-labels">
        <span><b className="c-caller">{formatNear(claim.stake)} Ⓝ</b> staked</span>
        <span><b className="c-fade">{formatNear(claim.total_faded)} Ⓝ</b> faded · {pct.toFixed(0)}%</span>
      </div>
      <div className="bar"><div className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

export function Near({ y, digits }: { y: string | bigint; digits?: number }) {
  return <>{formatNear(y, digits)} Ⓝ</>;
}

export function Spinner() {
  return <div className="spinner" aria-label="loading" />;
}
