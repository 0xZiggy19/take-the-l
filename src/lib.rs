//! # Take the L
//!
//! A public, on-chain ledger of crypto-Twitter calls with skin in the game.
//!
//! * A **caller** posts a claim ("$NEAR 2x by Friday") with a NEAR stake and a deadline.
//! * Anyone else can **fade** it by putting NEAR against it. Total fades are capped at the
//!   caller's stake, so every claim is an even-money (1:1) book. Fades close once 3/4 of the
//!   time to the deadline has passed (no last-second fades when the outcome is obvious).
//! * Before the deadline the caller self-resolves **W** or **L**. There is no oracle by design:
//!   the caller's public record is the product.
//! * If the caller stays silent past the deadline, anyone can call `resolve_timeout` and the
//!   claim is settled as an L and marked **Ghosted** on the caller's scoreboard.
//!
//! ## Payout rules (S = caller stake, F = total fades, F <= S, f_i = one fader's fade)
//!
//! | Outcome         | Caller receives | Each fader receives |
//! |-----------------|-----------------|---------------------|
//! | W               | S + F           | 0                   |
//! | L / Ghosted     | S - F           | 2 * f_i             |
//! | no fades (F=0)  | S (either way)  | -                   |
//!
//! Only the *matched* part of the caller's stake (F) is at risk; the unmatched part (S - F) is
//! always returned. Both sides risk the same amount for the same reward, which keeps it fair and
//! symmetric, and all payouts are exact (no division, no rounding dust).
//!
//! The caller's payout is pushed automatically on resolution. Faders pull their winnings with
//! `collect` (bounded gas no matter how many faders). Every transfer has a callback that
//! restores the balance if the transfer fails, so funds can never be lost to a failed promise.
//!
//! Storage is paid by the user who causes it: the exact storage cost of a new claim / fade /
//! profile is deducted from the attached deposit, and the rest becomes the stake or fade.

use near_sdk::json_types::U64;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, log,
    near, require,
};

/// Minimum stake a caller must put behind a claim (after storage is deducted).
pub const MIN_STAKE: NearToken = NearToken::from_millinear(100); // 0.1 NEAR
/// Minimum fade size (after storage is deducted).
pub const MIN_FADE: NearToken = NearToken::from_millinear(10); // 0.01 NEAR
/// Max distinct faders per claim. Keeps every claim bounded in size and gas.
pub const MAX_FADERS: usize = 50;
pub const MAX_TEXT_LEN: usize = 280;
pub const MAX_HANDLE_LEN: usize = 32;
pub const MAX_LINK_LEN: usize = 256;
/// Deadlines can be as short as 1 minute (for demos) and as long as 365 days.
pub const MIN_DURATION_MINUTES: u32 = 1;
pub const MAX_DURATION_MINUTES: u32 = 365 * 24 * 60;
const NANOS_PER_MINUTE: u64 = 60 * 1_000_000_000;
const GAS_FOR_PAYOUT_CALLBACK: Gas = Gas::from_tgas(10);
const MAX_PAGE: u32 = 100;
const EVENT_STANDARD: &str = "takethel";
const EVENT_VERSION: &str = "1.0.0";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Claims,
    Profiles,
    CallerClaims,
    FaderClaims,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Open,
    Won,
    Lost,
    Ghosted,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    W,
    L,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Fade {
    pub fader: AccountId,
    pub amount: NearToken,
    /// True once this fader's winnings have been paid out (only relevant for L / Ghosted).
    pub paid: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub caller: AccountId,
    pub text: String,
    pub x_handle: Option<String>,
    pub x_link: Option<String>,
    pub stake: NearToken,
    pub total_faded: NearToken,
    pub created_at: U64,
    /// Nanosecond timestamp. Caller must resolve strictly before this.
    pub deadline: U64,
    pub status: Status,
    pub resolved_at: Option<U64>,
    /// Who settled it (the caller, or whoever called `resolve_timeout`).
    pub resolved_by: Option<AccountId>,
    pub caller_paid: bool,
    pub fades: Vec<Fade>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    /// Claims created.
    pub calls: u32,
    pub wins: u32,
    pub losses: u32,
    /// Claims the caller never resolved (settled as L via `resolve_timeout`).
    pub ghosted: u32,
    /// Total NEAR this account has staked behind its own calls.
    pub total_staked: NearToken,
    /// Total NEAR this account has put against other people's calls.
    pub total_faded: NearToken,
    /// Number of distinct claims this account has faded.
    pub fades: u32,
}

#[near(serializers = [json])]
pub struct ProfileView {
    pub account_id: AccountId,
    #[serde(flatten)]
    pub profile: Profile,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    claims: Vector<Claim>,
    profiles: IterableMap<AccountId, Profile>,
    caller_claims: LookupMap<AccountId, Vec<u64>>,
    fader_claims: LookupMap<AccountId, Vec<u64>>,
}

/// Who a payout is for, so the callback knows what to restore on failure.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum Payee {
    Caller,
    Fader,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            claims: Vector::new(StorageKey::Claims),
            profiles: IterableMap::new(StorageKey::Profiles),
            caller_claims: LookupMap::new(StorageKey::CallerClaims),
            fader_claims: LookupMap::new(StorageKey::FaderClaims),
        }
    }

    // ------------------------------------------------------------------ writes

    /// Post a call. Attach the stake (plus a little for storage). Returns the claim id.
    #[payable]
    pub fn create_claim(
        &mut self,
        text: String,
        duration_minutes: u32,
        x_handle: Option<String>,
        x_link: Option<String>,
    ) -> u64 {
        let text = text.trim().to_string();
        require!(!text.is_empty(), "Claim text is empty");
        require!(
            text.chars().count() <= MAX_TEXT_LEN,
            "Claim text too long (max 280 chars)"
        );
        require!(
            (MIN_DURATION_MINUTES..=MAX_DURATION_MINUTES).contains(&duration_minutes),
            "duration_minutes must be between 1 and 525600"
        );
        let x_handle = normalize_handle(x_handle);
        let x_link = normalize_link(x_link);

        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let now = env::block_timestamp();
        let id = self.claims.len() as u64;
        let storage_before = env::storage_usage();

        self.claims.push(Claim {
            id,
            caller: caller.clone(),
            text: text.clone(),
            x_handle,
            x_link,
            stake: NearToken::from_yoctonear(0),
            total_faded: NearToken::from_yoctonear(0),
            created_at: U64(now),
            deadline: U64(now + duration_minutes as u64 * NANOS_PER_MINUTE),
            status: Status::Open,
            resolved_at: None,
            resolved_by: None,
            caller_paid: false,
            fades: Vec::new(),
        });
        self.caller_claims
            .entry(caller.clone())
            .or_default()
            .push(id);
        let profile = self.profiles.entry(caller.clone()).or_default();
        profile.calls += 1;
        self.flush_for_measure();

        let storage_cost = storage_cost_since(storage_before);
        require!(
            deposit >= storage_cost.saturating_add(MIN_STAKE),
            format!(
                "Attach at least {} yoctoNEAR (0.1 NEAR min stake + {} storage)",
                storage_cost.saturating_add(MIN_STAKE).as_yoctonear(),
                storage_cost.as_yoctonear()
            )
        );
        let stake = deposit.saturating_sub(storage_cost);

        let claim = self.claims.get_mut(id as u32).unwrap();
        claim.stake = stake;
        let deadline = claim.deadline;
        let profile = self.profiles.get_mut(&caller).unwrap();
        profile.total_staked = profile.total_staked.saturating_add(stake);

        emit(
            "claim_created",
            near_sdk::serde_json::json!({
                "claim_id": id, "caller": caller, "text": text,
                "stake": stake, "deadline": deadline, "storage_cost": storage_cost,
            }),
        );
        id
    }

    /// Put NEAR against a call. Fades are capped at the caller's stake; any excess is refunded.
    #[payable]
    pub fn fade(&mut self, claim_id: u64) -> NearToken {
        let fader = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let now = env::block_timestamp();
        let storage_before = env::storage_usage();

        let claim = self.claim_mut(claim_id);
        require!(claim.status == Status::Open, "Claim is already resolved");
        require!(
            now < fades_close_at(claim),
            "Too late to fade: fading is closed for the last quarter of a call's time"
        );
        require!(claim.caller != fader, "You can't fade your own call");
        let remaining = claim.stake.saturating_sub(claim.total_faded);
        require!(!remaining.is_zero(), "This call is fully faded");

        let is_new_fader = !claim.fades.iter().any(|f| f.fader == fader);
        if is_new_fader {
            require!(
                claim.fades.len() < MAX_FADERS,
                "Too many faders on this call"
            );
            claim.fades.push(Fade {
                fader: fader.clone(),
                amount: NearToken::from_yoctonear(0),
                paid: false,
            });
            self.fader_claims
                .entry(fader.clone())
                .or_default()
                .push(claim_id);
        }
        let profile = self.profiles.entry(fader.clone()).or_default();
        if is_new_fader {
            profile.fades += 1;
        }
        self.flush_for_measure();

        let storage_cost = storage_cost_since(storage_before);
        require!(
            deposit >= storage_cost.saturating_add(MIN_FADE),
            format!(
                "Attach at least {} yoctoNEAR (0.01 NEAR min fade + {} storage)",
                storage_cost.saturating_add(MIN_FADE).as_yoctonear(),
                storage_cost.as_yoctonear()
            )
        );
        let effective = deposit.saturating_sub(storage_cost);
        let accepted = if effective > remaining {
            remaining
        } else {
            effective
        };
        let refund = effective.saturating_sub(accepted);

        let claim = self.claim_mut(claim_id);
        claim.total_faded = claim.total_faded.saturating_add(accepted);
        let entry = claim.fades.iter_mut().find(|f| f.fader == fader).unwrap();
        entry.amount = entry.amount.saturating_add(accepted);
        let total_faded = claim.total_faded;
        let profile = self.profiles.get_mut(&fader).unwrap();
        profile.total_faded = profile.total_faded.saturating_add(accepted);

        emit(
            "claim_faded",
            near_sdk::serde_json::json!({
                "claim_id": claim_id, "fader": fader, "amount": accepted,
                "refund": refund, "total_faded": total_faded,
            }),
        );
        if !refund.is_zero() {
            // Refund goes back to the predecessor, which necessarily exists.
            let _ = Promise::new(fader).transfer(refund);
        }
        accepted
    }

    /// Caller marks their own call W or L. Only before the deadline, only once.
    /// The caller's payout is sent automatically.
    pub fn resolve(&mut self, claim_id: u64, outcome: Outcome) -> Promise {
        let who = env::predecessor_account_id();
        let now = env::block_timestamp();
        let claim = self.claim_mut(claim_id);
        require!(claim.caller == who, "Only the caller can resolve this call");
        require!(claim.status == Status::Open, "Claim is already resolved");
        require!(
            now < claim.deadline.0,
            "Deadline passed: the call can only be settled with resolve_timeout (as an L)"
        );
        let status = match outcome {
            Outcome::W => Status::Won,
            Outcome::L => Status::Lost,
        };
        self.settle(claim_id, status, who)
    }

    /// Anyone can settle a call whose caller went silent past the deadline. Counts as an L.
    pub fn resolve_timeout(&mut self, claim_id: u64) -> Promise {
        let who = env::predecessor_account_id();
        let now = env::block_timestamp();
        let claim = self.claim_mut(claim_id);
        require!(claim.status == Status::Open, "Claim is already resolved");
        require!(now >= claim.deadline.0, "Deadline has not passed yet");
        self.settle(claim_id, Status::Ghosted, who)
    }

    /// Pull your payout for a resolved claim (faders after an L/Ghosted, or the caller if the
    /// automatic payout failed).
    pub fn collect(&mut self, claim_id: u64) -> Promise {
        let who = env::predecessor_account_id();
        let claim = self.claim_mut(claim_id);
        require!(claim.status != Status::Open, "Claim is not resolved yet");
        if claim.caller == who {
            require!(!claim.caller_paid, "Nothing to collect");
            let amount = caller_payout(claim);
            claim.caller_paid = true;
            return pay(claim_id, who, amount, Payee::Caller);
        }
        require!(
            matches!(claim.status, Status::Lost | Status::Ghosted),
            "The caller won this one: nothing to collect"
        );
        let fade = claim
            .fades
            .iter_mut()
            .find(|f| f.fader == who)
            .unwrap_or_else(|| env::panic_str("You did not fade this call"));
        require!(!fade.paid, "Already collected");
        fade.paid = true;
        let amount = fade.amount.saturating_mul(2);
        emit(
            "payout_collected",
            near_sdk::serde_json::json!({"claim_id": claim_id, "account": who, "amount": amount}),
        );
        pay(claim_id, who, amount, Payee::Fader)
    }

    /// Restores the paid flag if a payout transfer failed so the account can `collect` again.
    #[private]
    pub fn on_payout(
        &mut self,
        claim_id: u64,
        account: AccountId,
        amount: NearToken,
        payee: Payee,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        log!(
            "Payout of {} to {} failed; it can be collected again",
            amount,
            account
        );
        let claim = self.claim_mut(claim_id);
        match payee {
            Payee::Caller => claim.caller_paid = false,
            Payee::Fader => {
                if let Some(f) = claim.fades.iter_mut().find(|f| f.fader == account) {
                    f.paid = false;
                }
            }
        }
        false
    }

    // ------------------------------------------------------------------- views

    pub fn get_claim(&self, claim_id: u64) -> Option<Claim> {
        self.claims.get(to_index(claim_id)?).cloned()
    }

    /// Newest first when `newest_first` is true (default), paginated.
    pub fn list_claims(
        &self,
        from_index: Option<u64>,
        limit: Option<u32>,
        newest_first: Option<bool>,
    ) -> Vec<Claim> {
        let len = self.claims.len() as u64;
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(20).min(MAX_PAGE) as u64;
        if from >= len {
            return vec![];
        }
        let end = (from + limit).min(len);
        (from..end)
            .map(|i| {
                if newest_first.unwrap_or(true) {
                    len - 1 - i
                } else {
                    i
                }
            })
            .map(|i| self.claims.get(i as u32).unwrap().clone())
            .collect()
    }

    pub fn get_claims_count(&self) -> u64 {
        self.claims.len() as u64
    }

    pub fn list_claims_by_caller(&self, account_id: AccountId) -> Vec<Claim> {
        self.ids_to_claims(self.caller_claims.get(&account_id))
    }

    pub fn list_claims_by_fader(&self, account_id: AccountId) -> Vec<Claim> {
        self.ids_to_claims(self.fader_claims.get(&account_id))
    }

    pub fn get_profile(&self, account_id: AccountId) -> Profile {
        self.profiles.get(&account_id).cloned().unwrap_or_default()
    }

    /// Scoreboard: every account that has called or faded, paginated.
    pub fn list_profiles(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ProfileView> {
        self.profiles
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(MAX_PAGE) as usize)
            .map(|(a, p)| ProfileView {
                account_id: a.clone(),
                profile: p.clone(),
            })
            .collect()
    }

    /// What `account_id` would receive from `collect` (or auto-payout) right now.
    pub fn get_claimable(&self, claim_id: u64, account_id: AccountId) -> NearToken {
        let Some(claim) = self.get_claim(claim_id) else {
            return NearToken::from_yoctonear(0);
        };
        if claim.status == Status::Open {
            return NearToken::from_yoctonear(0);
        }
        if claim.caller == account_id {
            return if claim.caller_paid {
                NearToken::from_yoctonear(0)
            } else {
                caller_payout(&claim)
            };
        }
        if claim.status == Status::Won {
            return NearToken::from_yoctonear(0);
        }
        claim
            .fades
            .iter()
            .find(|f| f.fader == account_id && !f.paid)
            .map(|f| f.amount.saturating_mul(2))
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    // ---------------------------------------------------------------- internal

    fn settle(&mut self, claim_id: u64, status: Status, resolved_by: AccountId) -> Promise {
        let now = env::block_timestamp();
        let claim = self.claim_mut(claim_id);
        claim.status = status;
        claim.resolved_at = Some(U64(now));
        claim.resolved_by = Some(resolved_by.clone());
        claim.caller_paid = true;
        let caller = claim.caller.clone();
        let amount = caller_payout(claim);
        let (stake, total_faded) = (claim.stake, claim.total_faded);

        let profile = self.profiles.entry(caller.clone()).or_default();
        match status {
            Status::Won => profile.wins += 1,
            Status::Lost => profile.losses += 1,
            Status::Ghosted => profile.ghosted += 1,
            Status::Open => unreachable!(),
        }
        emit(
            "claim_resolved",
            near_sdk::serde_json::json!({
                "claim_id": claim_id, "caller": caller, "status": status,
                "resolved_by": resolved_by, "stake": stake, "total_faded": total_faded,
                "caller_payout": amount,
            }),
        );
        pay(claim_id, caller, amount, Payee::Caller)
    }

    fn claim_mut(&mut self, claim_id: u64) -> &mut Claim {
        let idx = to_index(claim_id).unwrap_or_else(|| env::panic_str("Claim not found"));
        self.claims
            .get_mut(idx)
            .unwrap_or_else(|| env::panic_str("Claim not found"))
    }

    fn ids_to_claims(&self, ids: Option<&Vec<u64>>) -> Vec<Claim> {
        ids.map(|ids| {
            ids.iter()
                .rev()
                .filter_map(|id| self.get_claim(*id))
                .collect()
        })
        .unwrap_or_default()
    }

    /// Write pending collection changes so `env::storage_usage()` reflects them.
    fn flush_for_measure(&mut self) {
        self.claims.flush();
        self.profiles.flush();
        self.caller_claims.flush();
        self.fader_claims.flush();
    }
}

/// Fades close once 3/4 of the time between posting and the deadline has passed, so nobody can
/// pile in at the last second when the outcome is already obvious. The caller can still settle
/// until the deadline.
pub fn fades_close_at(claim: &Claim) -> u64 {
    let (start, end) = (claim.created_at.0, claim.deadline.0);
    start + (end.saturating_sub(start) / 4) * 3
}

fn caller_payout(claim: &Claim) -> NearToken {
    match claim.status {
        Status::Won => claim.stake.saturating_add(claim.total_faded),
        Status::Lost | Status::Ghosted => claim.stake.saturating_sub(claim.total_faded),
        Status::Open => NearToken::from_yoctonear(0),
    }
}

fn pay(claim_id: u64, account: AccountId, amount: NearToken, payee: Payee) -> Promise {
    if amount.is_zero() {
        // Nothing to send (e.g. a fully-faded call that lost). Return a no-op callback promise.
        return Contract::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_PAYOUT_CALLBACK)
            .on_payout_noop();
    }
    Promise::new(account.clone()).transfer(amount).then(
        Contract::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_PAYOUT_CALLBACK)
            .on_payout(claim_id, account, amount, payee),
    )
}

#[near]
impl Contract {
    /// No-op used when a payout is zero, so write methods always return a Promise.
    #[private]
    pub fn on_payout_noop(&self) -> bool {
        true
    }
}

fn storage_cost_since(before: u64) -> NearToken {
    let after = env::storage_usage();
    let bytes = after.saturating_sub(before) as u128;
    env::storage_byte_cost().saturating_mul(bytes)
}

fn to_index(id: u64) -> Option<u32> {
    u32::try_from(id).ok()
}

fn normalize_handle(h: Option<String>) -> Option<String> {
    let h = h?.trim().trim_start_matches('@').to_string();
    if h.is_empty() {
        return None;
    }
    require!(h.len() <= MAX_HANDLE_LEN, "X handle too long");
    require!(
        h.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "X handle may only contain letters, digits and _"
    );
    Some(h)
}

fn normalize_link(l: Option<String>) -> Option<String> {
    let l = l?.trim().to_string();
    if l.is_empty() {
        return None;
    }
    require!(l.len() <= MAX_LINK_LEN, "Link too long");
    require!(
        l.starts_with("https://x.com/") || l.starts_with("https://twitter.com/"),
        "Link must start with https://x.com/ or https://twitter.com/"
    );
    Some(l)
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data],
        })
    );
}

#[cfg(test)]
mod tests;
