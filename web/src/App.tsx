import { HashRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import Feed from "./pages/Feed";
import Create from "./pages/Create";
import ClaimPage from "./pages/ClaimPage";
import Profile from "./pages/Profile";
import Board from "./pages/Board";
import { useWallet } from "./near/wallet";
import { shortAccount } from "./format";
import { CONTRACT_ID, EXPLORER, NETWORK } from "./config";

function Header() {
  const { ready, accountId, signIn, signOut } = useWallet();
  return (
    <header className="topbar">
      <Link to="/" className="logo" aria-label="Take the L home">
        TAKE THE <span className="logo-l">L</span>
      </Link>
      <nav>
        <NavLink to="/" end>Feed</NavLink>
        <NavLink to="/new">New call</NavLink>
        <NavLink to="/board">Scoreboard</NavLink>
        {accountId && <NavLink to={`/u/${accountId}`}>Me</NavLink>}
      </nav>
      <div className="wallet">
        {!ready ? <span className="muted">…</span> : accountId ? (
          <>
            <span className="acct-pill" data-testid="account">{shortAccount(accountId, 20)}</span>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={signIn} data-testid="btn-connect">Connect</button>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/new" element={<Create />} />
          <Route path="/claim/:id" element={<ClaimPage />} />
          <Route path="/u/:account" element={<Profile />} />
          <Route path="/board" element={<Board />} />
          <Route path="*" element={<Feed />} />
        </Routes>
      </main>
      <footer className="foot">
        <span>Built at NEAR HACKATHON 2026 · {NETWORK}</span>
        <a href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{CONTRACT_ID} ↗</a>
        <span>No oracle and no admin. Your record is all you've got.</span>
      </footer>
    </HashRouter>
  );
}
