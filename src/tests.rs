use super::*;
use near_sdk::test_utils::{VMContextBuilder, accounts};
use near_sdk::testing_env;

const MIN: u64 = NANOS_PER_MINUTE;

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn ctx(who: &AccountId, deposit: NearToken, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("takethel.testnet".parse().unwrap())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .attached_deposit(deposit)
        .block_timestamp(ts);
    testing_env!(b.build());
}

fn alice() -> AccountId {
    accounts(0)
}
fn bob() -> AccountId {
    accounts(1)
}
fn carol() -> AccountId {
    accounts(2)
}

/// Creates a 10-minute claim by alice with `stake_near` (+ storage) at t=0.
fn setup(stake_near: u128) -> (Contract, u64) {
    let mut c = Contract::new();
    ctx(&alice(), near(stake_near), 0);
    let id = c.create_claim(
        "$NEAR 2x by Friday".into(),
        10,
        Some("@0xZiggy_eth".into()),
        None,
    );
    (c, id)
}

#[test]
fn create_claim_deducts_storage_and_records_profile() {
    let (c, id) = setup(2);
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.status, Status::Open);
    assert_eq!(claim.x_handle.as_deref(), Some("0xZiggy_eth"));
    assert_eq!(claim.deadline.0, 10 * MIN);
    assert!(claim.stake < near(2));
    assert!(
        claim.stake > NearToken::from_millinear(1990),
        "storage cost should be tiny"
    );
    let p = c.get_profile(alice());
    assert_eq!(p.calls, 1);
    assert_eq!(p.total_staked, claim.stake);
    assert_eq!(c.get_claims_count(), 1);
    assert_eq!(c.list_claims_by_caller(alice()).len(), 1);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn create_claim_requires_min_stake() {
    let mut c = Contract::new();
    ctx(&alice(), NearToken::from_millinear(50), 0);
    c.create_claim("x".into(), 10, None, None);
}

#[test]
#[should_panic(expected = "duration_minutes")]
fn create_claim_rejects_zero_duration() {
    let mut c = Contract::new();
    ctx(&alice(), near(1), 0);
    c.create_claim("x".into(), 0, None, None);
}

#[test]
#[should_panic(expected = "Link must start with")]
fn create_claim_rejects_non_x_link() {
    let mut c = Contract::new();
    ctx(&alice(), near(1), 0);
    c.create_claim("x".into(), 10, None, Some("https://evil.example".into()));
}

#[test]
#[should_panic(expected = "too long")]
fn create_claim_rejects_long_text() {
    let mut c = Contract::new();
    ctx(&alice(), near(1), 0);
    c.create_claim("a".repeat(281), 10, None, None);
}

#[test]
fn fade_is_capped_at_stake() {
    let (mut c, id) = setup(1);
    let stake = c.get_claim(id).unwrap().stake;
    ctx(&bob(), near(5), MIN);
    let accepted = c.fade(id);
    assert_eq!(
        accepted, stake,
        "fade capped at caller's stake, excess refunded"
    );
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.total_faded, stake);
    assert_eq!(c.get_profile(bob()).fades, 1);
    assert_eq!(c.list_claims_by_fader(bob()).len(), 1);
}

#[test]
#[should_panic(expected = "fully faded")]
fn fade_rejected_when_full() {
    let (mut c, id) = setup(1);
    ctx(&bob(), near(5), MIN);
    c.fade(id);
    ctx(&carol(), near(1), MIN);
    c.fade(id);
}

#[test]
fn repeat_fades_aggregate() {
    let (mut c, id) = setup(5);
    ctx(&bob(), near(1), MIN);
    let a1 = c.fade(id);
    ctx(&bob(), near(1), MIN);
    let a2 = c.fade(id);
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.fades.len(), 1);
    assert_eq!(claim.fades[0].amount, a1.saturating_add(a2));
    assert_eq!(
        a2,
        near(1),
        "second fade from same account needs no new storage"
    );
    assert_eq!(c.get_profile(bob()).fades, 1);
}

#[test]
#[should_panic(expected = "can't fade your own call")]
fn caller_cannot_fade_own_claim() {
    let (mut c, id) = setup(1);
    ctx(&alice(), near(1), MIN);
    c.fade(id);
}

#[test]
#[should_panic(expected = "fading is closed")]
fn fade_after_deadline_rejected() {
    let (mut c, id) = setup(1);
    ctx(&bob(), near(1), 10 * MIN);
    c.fade(id);
}

#[test]
fn fade_allowed_before_cutoff() {
    // 10-minute claim: fades close at 7.5 minutes.
    let (mut c, id) = setup(1);
    ctx(&bob(), near(1), 7 * MIN);
    c.fade(id);
    assert_eq!(fades_close_at(&c.get_claim(id).unwrap()), 7 * MIN + MIN / 2);
}

#[test]
#[should_panic(expected = "fading is closed")]
fn fade_in_last_quarter_rejected() {
    let (mut c, id) = setup(1);
    ctx(&bob(), near(1), 7 * MIN + MIN / 2);
    c.fade(id);
}

#[test]
fn caller_can_still_resolve_after_fade_cutoff() {
    let (mut c, id) = setup(1);
    ctx(&alice(), NearToken::from_yoctonear(0), 9 * MIN);
    let _ = c.resolve(id, Outcome::L);
    assert_eq!(c.get_claim(id).unwrap().status, Status::Lost);
}

#[test]
#[should_panic(expected = "already resolved")]
fn fade_after_resolve_rejected() {
    let (mut c, id) = setup(1);
    ctx(&alice(), NearToken::from_yoctonear(0), MIN);
    let _ = c.resolve(id, Outcome::W);
    ctx(&bob(), near(1), 2 * MIN);
    c.fade(id);
}

#[test]
fn win_pays_caller_stake_plus_fades() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    let fb = c.fade(id);
    ctx(&carol(), NearToken::from_millinear(500), MIN);
    let fc = c.fade(id);
    let stake = c.get_claim(id).unwrap().stake;
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::W);
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.status, Status::Won);
    assert!(claim.caller_paid);
    assert_eq!(
        caller_payout(&claim),
        stake.saturating_add(fb).saturating_add(fc)
    );
    assert_eq!(c.get_claimable(id, bob()), NearToken::from_yoctonear(0));
    let p = c.get_profile(alice());
    assert_eq!((p.wins, p.losses, p.ghosted), (1, 0, 0));
}

#[test]
#[should_panic(expected = "caller won")]
fn fader_cannot_collect_after_win() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    c.fade(id);
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::W);
    ctx(&bob(), NearToken::from_yoctonear(0), 3 * MIN);
    let _ = c.collect(id);
}

#[test]
fn loss_pays_faders_double_and_returns_unmatched() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    let fb = c.fade(id);
    ctx(&carol(), NearToken::from_millinear(500), MIN);
    let fc = c.fade(id);
    let stake = c.get_claim(id).unwrap().stake;
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::L);
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.status, Status::Lost);
    assert_eq!(
        caller_payout(&claim),
        stake.saturating_sub(fb).saturating_sub(fc)
    );
    assert_eq!(c.get_claimable(id, bob()), fb.saturating_mul(2));
    assert_eq!(c.get_claimable(id, carol()), fc.saturating_mul(2));
    // conservation: everything paid out equals stake + fades
    let total = caller_payout(&claim)
        .saturating_add(fb.saturating_mul(2))
        .saturating_add(fc.saturating_mul(2));
    assert_eq!(total, stake.saturating_add(fb).saturating_add(fc));

    ctx(&bob(), NearToken::from_yoctonear(0), 3 * MIN);
    let _ = c.collect(id);
    assert_eq!(c.get_claimable(id, bob()), NearToken::from_yoctonear(0));
    assert_eq!(c.get_profile(alice()).losses, 1);
}

#[test]
#[should_panic(expected = "Already collected")]
fn double_collect_rejected() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    c.fade(id);
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::L);
    ctx(&bob(), NearToken::from_yoctonear(0), 3 * MIN);
    let _ = c.collect(id);
    let _ = c.collect(id);
}

#[test]
#[should_panic(expected = "did not fade")]
fn stranger_cannot_collect() {
    let (mut c, id) = setup(2);
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::L);
    ctx(&carol(), NearToken::from_yoctonear(0), 3 * MIN);
    let _ = c.collect(id);
}

#[test]
fn no_fades_refunds_stake_either_way() {
    for outcome in [Outcome::W, Outcome::L] {
        let (mut c, id) = setup(1);
        let stake = c.get_claim(id).unwrap().stake;
        ctx(&alice(), NearToken::from_yoctonear(0), MIN);
        let _ = c.resolve(id, outcome);
        assert_eq!(caller_payout(&c.get_claim(id).unwrap()), stake);
    }
}

#[test]
#[should_panic(expected = "already resolved")]
fn double_resolve_rejected() {
    let (mut c, id) = setup(1);
    ctx(&alice(), NearToken::from_yoctonear(0), MIN);
    let _ = c.resolve(id, Outcome::W);
    let _ = c.resolve(id, Outcome::L);
}

#[test]
#[should_panic(expected = "Only the caller")]
fn non_caller_cannot_resolve() {
    let (mut c, id) = setup(1);
    ctx(&bob(), NearToken::from_yoctonear(0), MIN);
    let _ = c.resolve(id, Outcome::L);
}

#[test]
#[should_panic(expected = "Deadline passed")]
fn caller_cannot_resolve_after_deadline() {
    let (mut c, id) = setup(1);
    ctx(&alice(), NearToken::from_yoctonear(0), 10 * MIN);
    let _ = c.resolve(id, Outcome::W);
}

#[test]
#[should_panic(expected = "not passed yet")]
fn timeout_before_deadline_rejected() {
    let (mut c, id) = setup(1);
    ctx(&carol(), NearToken::from_yoctonear(0), 5 * MIN);
    let _ = c.resolve_timeout(id);
}

#[test]
fn timeout_is_an_l_and_marks_ghosted() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    let fb = c.fade(id);
    ctx(&carol(), NearToken::from_yoctonear(0), 10 * MIN);
    let _ = c.resolve_timeout(id);
    let claim = c.get_claim(id).unwrap();
    assert_eq!(claim.status, Status::Ghosted);
    assert_eq!(claim.resolved_by, Some(carol()));
    assert_eq!(c.get_claimable(id, bob()), fb.saturating_mul(2));
    let p = c.get_profile(alice());
    assert_eq!((p.wins, p.losses, p.ghosted), (0, 0, 1));
}

#[test]
#[should_panic(expected = "already resolved")]
fn timeout_after_resolve_rejected() {
    let (mut c, id) = setup(1);
    ctx(&alice(), NearToken::from_yoctonear(0), MIN);
    let _ = c.resolve(id, Outcome::W);
    ctx(&carol(), NearToken::from_yoctonear(0), 20 * MIN);
    let _ = c.resolve_timeout(id);
}

#[test]
fn failed_payout_callback_restores_balance() {
    let (mut c, id) = setup(2);
    ctx(&bob(), near(1), MIN);
    let fb = c.fade(id);
    ctx(&alice(), NearToken::from_yoctonear(0), 2 * MIN);
    let _ = c.resolve(id, Outcome::L);
    ctx(&bob(), NearToken::from_yoctonear(0), 3 * MIN);
    let _ = c.collect(id);
    // simulate the transfer failing
    ctx(
        &"takethel.testnet".parse().unwrap(),
        NearToken::from_yoctonear(0),
        3 * MIN,
    );
    let ok = c.on_payout(
        id,
        bob(),
        fb.saturating_mul(2),
        Payee::Fader,
        Err(PromiseError::Failed),
    );
    assert!(!ok);
    assert_eq!(c.get_claimable(id, bob()), fb.saturating_mul(2));
}

#[test]
fn list_views_paginate_newest_first() {
    let mut c = Contract::new();
    for i in 0..5 {
        ctx(&alice(), near(1), 0);
        c.create_claim(format!("call {i}"), 10, None, None);
    }
    let page = c.list_claims(None, Some(2), None);
    assert_eq!(page.iter().map(|c| c.id).collect::<Vec<_>>(), vec![4, 3]);
    let page = c.list_claims(Some(4), Some(10), Some(false));
    assert_eq!(page.iter().map(|c| c.id).collect::<Vec<_>>(), vec![4]);
    assert!(c.list_claims(Some(9), None, None).is_empty());
    assert_eq!(c.list_profiles(None, None).len(), 1);
    assert!(c.get_claim(99).is_none());
}
