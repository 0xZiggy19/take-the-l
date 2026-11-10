import { useParams } from "react-router-dom";
import { api } from "../near/rpc";
import { usePoll } from "../hooks";
import { ClaimCard } from "../components/ClaimCard";
import { DaoTag, Near, Spinner } from "../components/bits";
import { isDao } from "../format";
import { EXPLORER } from "../config";

export default function Profile() {
  const account = useParams().account!;
  const { data } = usePoll(async () => {
    const [profile, calls, fades] = await Promise.all([api.profile(account), api.byCaller(account), api.byFader(account)]);
    return { profile, calls, fades };
  }, [account], 6000);
  if (!data) return <Spinner />;
  const { profile: p, calls, fades } = data;
  const settled = p.wins + p.losses + p.ghosted;
  const hitRate = settled ? Math.round((p.wins / settled) * 100) : null;
  const handle = calls.find((c) => c.x_handle)?.x_handle;
  const fadesWon = fades.filter((c) => c.status === "Lost" || c.status === "Ghosted").length;
  const fadesLost = fades.filter((c) => c.status === "Won").length;

  return (
    <section>
      <div className="card profile-hero">
        <div>
          <h1 className="page-title">{handle ? `@${handle}` : account}</h1>
          <a className="muted mono" href={`${EXPLORER}/address/${account}`} target="_blank" rel="noreferrer">{account} ↗</a>
          {isDao(account) && <p className="muted dao-note"><DaoTag /> A Sputnik DAO. Its members vote on every call it makes, every fade and every collect, and the winnings go back to the DAO treasury.</p>}
        </div>
        <div className="record" data-testid="record">
          <span className="c-w">{p.wins}W</span>
          <span className="c-l">{p.losses}L</span>
          <span className="c-ghost">{p.ghosted}👻</span>
        </div>
        <div className="stats">
          <div><b>{p.calls}</b><span>calls</span></div>
          <div><b>{hitRate === null ? "–" : `${hitRate}%`}</b><span>hit rate</span></div>
          <div><b><Near y={p.total_staked} digits={2} /></b><span>staked</span></div>
          <div><b>{p.fades}</b><span>fades ({fadesWon} won · {fadesLost} lost)</span></div>
          <div><b><Near y={p.total_faded} digits={2} /></b><span>faded</span></div>
        </div>
      </div>
      <h2 className="section-title">Calls</h2>
      {calls.length === 0 ? <p className="muted">No calls yet.</p> : <div className="grid">{calls.map((c) => <ClaimCard key={c.id} claim={c} />)}</div>}
      <h2 className="section-title">Fades</h2>
      {fades.length === 0 ? <p className="muted">No fades yet.</p> : <div className="grid">{fades.map((c) => <ClaimCard key={c.id} claim={c} />)}</div>}
    </section>
  );
}
