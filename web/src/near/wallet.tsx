import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONTRACT_ID, E2E_KEY_SIGNER, GAS, NETWORK, RPC_URLS } from "../config";

/** Result of a contract call: the tx hash and the decoded return value (if any). */
export interface TxResult { hash?: string; value?: unknown }

interface WalletCtx {
  ready: boolean;
  accountId: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  call: (method: string, args: object, deposit?: bigint) => Promise<TxResult>;
}

const Ctx = createContext<WalletCtx | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Outcome = any;

function decodeOutcome(outcome: Outcome): TxResult {
  if (!outcome) return {};
  const hash: string | undefined = outcome.transaction?.hash ?? outcome.transaction_outcome?.id;
  const status = outcome.status ?? outcome.final_execution_status;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new Error(extractPanic(status.Failure) ?? "Transaction failed");
  }
  let value: unknown;
  const sv = status && typeof status === "object" ? status.SuccessValue : undefined;
  if (typeof sv === "string" && sv.length) {
    try { value = JSON.parse(atob(sv)); } catch { /* not JSON */ }
  }
  return { hash, value };
}

function extractPanic(failure: unknown): string | undefined {
  const s = JSON.stringify(failure);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/) ?? s.match(/"ExecutionError":"([^"]+)"/);
  return m?.[1];
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/Smart contract panicked: ([^"\\\n]+)/);
  if (m) return m[1];
  if (/reject|cancel|closed|User denied/i.test(msg)) return "Cancelled in wallet";
  return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const impl = useRef<{ signIn: () => void; signOut: () => Promise<void>; call: WalletCtx["call"] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (E2E_KEY_SIGNER) {
        impl.current = await setupKeySigner(setAccountId);
      } else {
        impl.current = await setupSelector(setAccountId);
      }
      if (!cancelled) setReady(true);
    })().catch((e) => {
      console.error("wallet init failed", e);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(() => impl.current?.signIn(), []);
  const signOut = useCallback(async () => { await impl.current?.signOut(); }, []);
  const call = useCallback<WalletCtx["call"]>(async (m, a, d) => {
    if (!impl.current) throw new Error("Wallet not ready");
    return impl.current.call(m, a, d);
  }, []);

  const value = useMemo(() => ({ ready, accountId, signIn, signOut, call }), [ready, accountId, signIn, signOut, call]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside provider");
  return c;
}

async function setupSelector(setAccountId: (a: string | null) => void) {
  const [{ setupWalletSelector, actionCreators }, { setupModal }, mnw, meteor, hot, intear] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/my-near-wallet"),
    import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/hot-wallet"),
    import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/modal-ui/styles.css"),
  ]);
  const selector = await setupWalletSelector({
    network: NETWORK,
    modules: [mnw.setupMyNearWallet(), meteor.setupMeteorWallet(), hot.setupHotWallet(), intear.setupIntearWallet()],
  });
  const modal = setupModal(selector, {
    contractId: CONTRACT_ID,
    theme: "dark",
    description: "Connect a NEAR testnet wallet to post calls and fade them.",
  });
  const sync = (accounts: { accountId: string; active: boolean }[]) =>
    setAccountId(accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null);
  sync(selector.store.getState().accounts);
  selector.store.observable.subscribe((s) => sync(s.accounts));

  return {
    signIn: () => modal.show(),
    signOut: async () => {
      const w = await selector.wallet();
      await w.signOut();
      setAccountId(null);
    },
    call: async (method: string, args: object, deposit = 0n): Promise<TxResult> => {
      const w = await selector.wallet();
      const outcome = await w.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [actionCreators.functionCall(method, args, GAS, deposit)],
      });
      return decodeOutcome(outcome);
    },
  };
}

/**
 * E2E/demo signer: reads `ttl_e2e_account` and `ttl_e2e_key` from localStorage and signs
 * directly with near-api-js. Only compiled in when VITE_E2E_KEY_SIGNER=1.
 */
async function setupKeySigner(setAccountId: (a: string | null) => void) {
  const { Account } = await import("near-api-js");
  const load = () => {
    const id = localStorage.getItem("ttl_e2e_account");
    const key = localStorage.getItem("ttl_e2e_key");
    return id && key ? { id, key } : null;
  };
  setAccountId(load()?.id ?? null);
  return {
    signIn: () => {
      const id = prompt("Test account id");
      const key = id ? prompt("ed25519 private key (test only)") : null;
      if (id && key) {
        localStorage.setItem("ttl_e2e_account", id);
        localStorage.setItem("ttl_e2e_key", key);
        setAccountId(id);
      }
    },
    signOut: async () => {
      localStorage.removeItem("ttl_e2e_account");
      localStorage.removeItem("ttl_e2e_key");
      setAccountId(null);
    },
    call: async (method: string, args: object, deposit = 0n): Promise<TxResult> => {
      const creds = load();
      if (!creds) throw new Error("Not signed in");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const account = new Account(creds.id, RPC_URLS[0], creds.key as any);
      const outcome = await account.callFunctionRaw({
        contractId: CONTRACT_ID, methodName: method, args, deposit, gas: GAS,
      });
      return decodeOutcome(outcome);
    },
  };
}
