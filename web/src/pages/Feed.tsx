import { useState } from "react";
import { Link } from "react-router-dom";
import { allClaims } from "../near/rpc";
import { usePoll } from "../hooks";
import { ClaimCard } from "../components/ClaimCard";
import { Near, Spinner } from "../components/bits";
import type { Status } from "../near/types";

const FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Open", label: "Live" },
  { key: "Won", label: "W" },
  { key: "Lost", label: "L" },
  { key: "Ghosted", label: "Ghosted" },
];

export default function Feed() {
  const { data, error } = usePoll(allClaims, [], 5000);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const claims = (data ?? []).filter((c) => filter === "all" || c.status === filter);
  const totalStaked = (data ?? []).reduce((a, c) => a + BigInt(c.stake) + BigInt(c.total_faded), 0n);
  const ls = (data ?? []).filter((c) => c.status === "Lost" || c.status === "Ghosted").length;

  return (
    <>
      <section className="hero">
        <h1>
          Put your <span className="hl-w">NEAR</span> where<br />your mouth is.
        </h1>
        <p className="lede">
          Post a call with a stake. Anyone can fade you. Call your own <b className="c-w">W</b> or{" "}
          <b className="c-l">L</b> before the deadline, or get marked <b className="c-ghost">ghosted</b>. Every result stays on-chain for good.
        </p>
        <div className="hero-cta">
          <Link to="/new" className="btn btn-primary btn-lg" data-testid="cta-new">Make a call</Link>
          <Link to="/board" className="btn btn-ghost btn-lg">Hall of Ls</Link>
        </div>
        <div className="stats">
          <div><b>{data ? data.length : "–"}</b><span>calls</span></div>
          <div><b>{data ? <Near y={totalStaked} digits={2} /> : "–"}</b><span>NEAR staked + faded</span></div>
          <div><b className="c-l">{data ? ls : "–"}</b><span>Ls taken</span></div>
        </div>
      </section>

      <div className="filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key}
            className={`chip ${filter === f.key ? "chip-on" : ""} chip-${f.key.toLowerCase()}`}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {error && <div className="error">Couldn't reach NEAR RPC: {error}</div>}
      {!data && !error && <Spinner />}
      {data && claims.length === 0 && <div className="empty">No calls here yet. <Link to="/new">Be the first.</Link></div>}
      <div className="grid" data-testid="feed">
        {claims.map((c) => <ClaimCard key={c.id} claim={c} />)}
      </div>
    </>
  );
}
