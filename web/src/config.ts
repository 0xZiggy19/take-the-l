export const NETWORK = (import.meta.env.VITE_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "takethel-eadf0a.testnet";
export const RPC_URLS: string[] = (import.meta.env.VITE_RPC_URLS ??
  "https://test.rpc.fastnear.com,https://rpc.testnet.near.org").split(",");
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const GAS = 100_000_000_000_000n; // 100 Tgas
/** E2E-only signer that uses a raw key from localStorage. Never enabled in a normal build. */
export const E2E_KEY_SIGNER = import.meta.env.VITE_E2E_KEY_SIGNER === "1";
