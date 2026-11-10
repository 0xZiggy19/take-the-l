import { CONTRACT_ID, RPC_URLS } from "../config";
import type { Claim, Profile, ProfileView } from "./types";

let rpcIndex = 0;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    const url = RPC_URLS[(rpcIndex + attempt) % RPC_URLS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "ttl", method, params }),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error?.cause?.name ?? json.error.message ?? "RPC error");
      rpcIndex = (rpcIndex + attempt) % RPC_URLS.length;
      return json.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const result = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT_ID,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  if (result.error) throw new Error(result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

export const api = {
  count: () => view<number>("get_claims_count"),
  listClaims: (from_index = 0, limit = 100) => view<Claim[]>("list_claims", { from_index, limit, newest_first: true }),
  getClaim: (claim_id: number) => view<Claim | null>("get_claim", { claim_id }),
  byCaller: (account_id: string) => view<Claim[]>("list_claims_by_caller", { account_id }),
  byFader: (account_id: string) => view<Claim[]>("list_claims_by_fader", { account_id }),
  profile: (account_id: string) => view<Profile>("get_profile", { account_id }),
  profiles: (from_index = 0, limit = 100) => view<ProfileView[]>("list_profiles", { from_index, limit }),
  claimable: (claim_id: number, account_id: string) => view<string>("get_claimable", { claim_id, account_id }),
};

/** Fetch all claims (pages of 100). */
export async function allClaims(): Promise<Claim[]> {
  const out: Claim[] = [];
  for (let from = 0; ; from += 100) {
    const page = await api.listClaims(from, 100);
    out.push(...page);
    if (page.length < 100) return out;
  }
}

export async function allProfiles(): Promise<ProfileView[]> {
  const out: ProfileView[] = [];
  for (let from = 0; ; from += 100) {
    const page = await api.profiles(from, 100);
    out.push(...page);
    if (page.length < 100) return out;
  }
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
    return true;
  } catch {
    return false;
  }
}
