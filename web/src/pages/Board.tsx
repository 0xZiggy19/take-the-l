import { useState } from "react";
import { Link } from "react-router-dom";
import { allProfiles } from "../near/rpc";
import { usePoll } from "../hooks";
import { DaoTag, Near, Spinner } from "../components/bits";
import { isDao, shortAccount } from "../format";
import type { ProfileView } from "../near/types";

type Tab = "ls" | "ws" | "ghosts" | "faders";
const TABS: { key: Tab; label: string; blurb: string; score: (p: ProfileView) => number; show: (p: ProfileView) => React.ReactNode }[] = [
  { key: "ls", label: "Ls taken", blurb: "Everyone who took the L or got caught ghosting.",
    score: (p) => p.losses + p.ghosted, show: (p) => <><b className="c-l">{p.losses + p.ghosted} L</b> <span className="muted">({p.ghosted} ghosted)</span></> },
  { key: "ws", label: "Most Ws", blurb: "The callers who keep hitting.",
    score: (p) => p.wins, show: (p) => <b className="c-w">{p.wins} W</b> },
  { key: "ghosts", label: "Ghosts", blurb: "Callers who went quiet past their deadline. Fade them on sight.",
    score: (p) => p.ghosted, show: (p) => <b className="c-ghost">{p.ghosted} 👻</b> },
  { key: "faders", label: "Top faders", blurb: "Who puts the most NEAR against other people's calls.",
    score: (p) => Number(BigInt(p.total_faded) / 10n ** 20n), show: (p) => <b className="c-fade"><Near y={p.total_faded} digits={2} /></b> },
];

export default function Board() {
  const { data } = usePoll(allProfiles, [], 8000);
  const [tab, setTab] = useState<Tab>("ls");
  const t = TABS.find((x) => x.key === tab)!;
  const rows = (data ?? []).filter((p) => t.score(p) > 0).sort((a, b) => t.score(b) - t.score(a));

  return (
    <section className="narrow">
      <h1 className="page-title">Scoreboard</h1>
      <div className="filters">
        {TABS.map((x) => (
          <button key={x.key} className={`chip ${tab === x.key ? "chip-on" : ""}`} onClick={() => setTab(x.key)} data-testid={`tab-${x.key}`}>{x.label}</button>
        ))}
      </div>
      <p className="muted">{t.blurb}</p>
      {!data ? <Spinner /> : rows.length === 0 ? <p className="empty">Nobody here yet.</p> : (
        <ol className="board card" data-testid="board">
          {rows.map((p, i) => (
            <li key={p.account_id} className={i < 3 ? `top top-${i + 1}` : ""}>
              <span className="rank">{i + 1}</span>
              <Link to={`/u/${p.account_id}`} className="acct"><b>{shortAccount(p.account_id, 28)}</b>{isDao(p.account_id) && <DaoTag />}</Link>
              <span className="rec muted">{p.wins}W · {p.losses}L · {p.ghosted}👻</span>
              <span className="score">{t.show(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
