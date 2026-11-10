import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet, cleanError } from "../near/wallet";
import { useToast } from "../components/Toast";
import { parseNear, formatNear, timeLeft } from "../format";
import { TestnetHint } from "../components/bits";

const STAKES = ["0.1", "0.5", "1", "5"];
const DURATIONS: { label: string; minutes: number; demo?: boolean }[] = [
  { label: "1 min", minutes: 1, demo: true },
  { label: "3 min", minutes: 3, demo: true },
  { label: "10 min", minutes: 10, demo: true },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "1 week", minutes: 10080 },
  { label: "30 days", minutes: 43200 },
];

export default function Create() {
  const { accountId, signIn, call } = useWallet();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [stake, setStake] = useState("1");
  const [minutes, setMinutes] = useState(3);
  const [handle, setHandle] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const stakeErr = useMemo(() => {
    try {
      const y = parseNear(stake);
      if (y < parseNear("0.11")) return "Minimum is 0.11 NEAR (0.1 stake plus a tiny storage fee)";
      return null;
    } catch (e) { return (e as Error).message; }
  }, [stake]);
  const linkErr = link && !/^https:\/\/(x|twitter)\.com\//.test(link.trim()) ? "Link must start with https://x.com/" : null;
  const handleErr = handle && !/^@?[A-Za-z0-9_]{1,32}$/.test(handle.trim()) ? "Letters, digits and _ only" : null;
  const canSubmit = text.trim().length > 0 && text.length <= 280 && !stakeErr && !linkErr && !handleErr && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return signIn();
    setBusy(true);
    try {
      const args: Record<string, unknown> = { text: text.trim(), duration_minutes: minutes };
      if (handle.trim()) args.x_handle = handle.trim();
      if (link.trim()) args.x_link = link.trim();
      const res = await call("create_claim", args, parseNear(stake));
      toast({ kind: "ok", text: "Call posted. It's on-chain now.", hash: res.hash });
      nav(typeof res.value === "number" ? `/claim/${res.value}` : "/");
    } catch (err) {
      toast({ kind: "err", text: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <h1 className="page-title">Make a call</h1>
      <p className="muted">Your stake is the most anyone can fade. If they fade you and you win, you take their NEAR. If you take the L, they take yours.</p>
      <form className="card form" onSubmit={submit}>
        <label>
          <span>The call</span>
          <textarea data-testid="in-text" value={text} maxLength={280} rows={3}
            placeholder="$NEAR 2x by Friday" onChange={(e) => setText(e.target.value)} />
          <small className={text.length > 260 ? "c-l" : "muted"}>{text.length}/280</small>
        </label>

        <label>
          <span>Stake (NEAR)</span>
          <div className="chips">
            {STAKES.map((s) => (
              <button type="button" key={s} className={`chip ${stake === s ? "chip-on" : ""}`} onClick={() => setStake(s)}>{s} Ⓝ</button>
            ))}
            <input data-testid="in-stake" className="chip-input" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} />
          </div>
          {stakeErr && <small className="c-l">{stakeErr}</small>}
        </label>

        <label>
          <span>Deadline</span>
          <div className="chips">
            {DURATIONS.map((d) => (
              <button type="button" key={d.minutes} data-testid={`dur-${d.minutes}`}
                className={`chip ${minutes === d.minutes ? "chip-on" : ""}`} onClick={() => setMinutes(d.minutes)}>
                {d.label}{d.demo && <sup>demo</sup>}
              </button>
            ))}
          </div>
          <small className="muted">You have to call W or L within {DURATIONS.find((d) => d.minutes === minutes)?.label ?? timeLeft(minutes * 60_000)}. Miss it and anyone can settle it as an L. Fades close after {timeLeft(minutes * 45_000)}, so nobody can fade at the last second.</small>
        </label>

        <div className="row2">
          <label>
            <span>X handle <em>(optional)</em></span>
            <input data-testid="in-handle" value={handle} placeholder="@0xZiggy_eth" onChange={(e) => setHandle(e.target.value)} />
            {handleErr && <small className="c-l">{handleErr}</small>}
          </label>
          <label>
            <span>Link to the post <em>(optional)</em></span>
            <input data-testid="in-link" value={link} placeholder="https://x.com/…/status/…" onChange={(e) => setLink(e.target.value)} />
            {linkErr && <small className="c-l">{linkErr}</small>}
          </label>
        </div>

        <div className="form-foot">
          <div className="muted">Attaching <b className="c-caller">{stakeErr ? "–" : formatNear(parseNear(stake))} Ⓝ</b>. A small storage fee (~0.004) comes out of it.</div>
          {accountId ? (
            <button className="btn btn-primary btn-lg" disabled={!canSubmit} data-testid="btn-create">
              {busy ? "Signing…" : "Stake it"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={signIn}>Connect wallet</button>
          )}
        </div>
        {!accountId && <TestnetHint />}
      </form>
    </section>
  );
}
