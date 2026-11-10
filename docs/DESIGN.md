# Take the L: contract design

## Flow
1. **Call**: `create_claim(text, duration_minutes, x_handle?, x_link?)` with NEAR attached. The storage cost of the new record is deducted from the deposit, and the rest is the **stake** S (minimum 0.1 NEAR). Deadlines run from 1 minute (so demos are quick) to 365 days.
2. **Fade**: `fade(claim_id)` with NEAR attached. The caller can't fade their own call. Fading is only allowed while the claim is Open and before the deadline. Total fades F are **capped at S**, and any excess is refunded in the same transaction. Repeat fades from the same account are added together. A claim can have at most 50 distinct faders.
3. **Resolve**: the caller calls `resolve(claim_id, "W" | "L")` strictly before the deadline, and can only do it once. No oracle is involved: the caller's public record is the accountability mechanism.
4. **Ghosted**: once the deadline passes, the caller can no longer resolve. Anyone can call `resolve_timeout(claim_id)`, which settles the claim as an L and adds to the caller's `ghosted` count.
5. **Payout**: the caller's payout is pushed automatically when the claim is resolved. Faders pull theirs with `collect(claim_id)`. Every transfer has a private `on_payout` callback that re-opens the balance if the transfer fails, so funds can't get stuck.

## Payout rules (an even-money 1:1 book)
S = caller stake, F = sum of fades (F ≤ S), f_i = one fader's fade.

| Outcome | Caller gets | Each fader gets |
|---|---|---|
| W | S + F | 0 |
| L or Ghosted | S − F | 2·f_i |
| No fades | S (W or L) | – |

Only the matched part of the stake (F) is at risk, and the unmatched part (S − F) always goes back to the caller. Both sides risk the same amount for the same reward, so the payouts are symmetric. Every payout is exact (no division and no rounding dust), and the payouts always add up to S + F.

## Security notes
- Each claim can only be settled once (`status` must be Open), and each payout can only be paid once (`caller_paid` / `fade.paid` flags are set before the transfer and restored by the callback if the transfer fails).
- Gas is bounded: resolution makes a single transfer. Fader payouts are pulled individually, and the number of faders per claim is capped.
- Storage is paid by whoever adds the data. It is measured with `env::storage_usage()` before and after the write and deducted from the deposit.
- Inputs are validated: text is at most 280 characters, the X handle may only contain `[A-Za-z0-9_]` (32 characters max), and the link must start with `https://x.com/` or `https://twitter.com/`.
- `on_payout` and `on_payout_noop` are `#[private]`.
- The contract has no admin and no owner key paths.
- **Trust model:** the caller decides the outcome, so a dishonest caller can mark a false W. That is deliberate: every call, outcome and ghosting is public and permanent on the scoreboard, and faders choose who to fade.

## Methods
Change methods: `new()` (init), `create_claim` (payable), `fade` (payable), `resolve`, `resolve_timeout`, `collect`, `on_payout` (private), `on_payout_noop` (private).

View methods: `get_claim(claim_id)`, `list_claims(from_index?, limit?, newest_first?)`, `get_claims_count()`, `list_claims_by_caller(account_id)`, `list_claims_by_fader(account_id)`, `get_profile(account_id)` (calls, wins, losses, ghosted, total_staked, total_faded, fades), `list_profiles(from_index?, limit?)`, `get_claimable(claim_id, account_id)`.

Events: NEP-297 `EVENT_JSON` logs (`standard: "takethel"`): `claim_created`, `claim_faded`, `claim_resolved`, `payout_collected`.
