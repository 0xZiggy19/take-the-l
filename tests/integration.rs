//! Integration tests against a real local NEAR node (near-sandbox) with the compiled wasm.
//! Run: `cargo test --test integration -- --test-threads=2`

use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::{Arc, OnceLock};

static WASM: OnceLock<Vec<u8>> = OnceLock::new();

fn wasm() -> Vec<u8> {
    WASM.get_or_init(|| {
        let path = cargo_near_build::build_with_cli(Default::default()).expect("build wasm");
        std::fs::read(path).expect("read wasm")
    })
    .clone()
}

type R<T = ()> = testresult::TestResult<T>;

struct Env {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    contract: AccountId,
    alice: AccountId,
    bob: AccountId,
    carol: AccountId,
}

const TGAS100: NearGas = NearGas::from_tgas(100);

async fn setup() -> R<Env> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;
    let mut ids = vec![];
    for name in ["contract", "alice", "bob", "carol"] {
        let id: AccountId = format!("{name}.sandbox").parse()?;
        sandbox
            .create_account(id.as_str().parse()?)
            .initial_balance(NearToken::from_near(50))
            .send()
            .await?;
        ids.push(id);
    }
    let contract = ids[0].clone();
    near_api::Contract::deploy(contract.clone())
        .use_code(wasm())
        .with_init_call("new", json!({}))?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    Ok(Env {
        sandbox,
        net,
        signer,
        contract,
        alice: ids[1].clone(),
        bob: ids[2].clone(),
        carol: ids[3].clone(),
    })
}

impl Env {
    async fn call(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> R<bool> {
        let res = near_api::Contract(self.contract.clone())
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(TGAS100)
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await?;
        Ok(res.is_success())
    }
    async fn ok(&self, who: &AccountId, method: &str, args: Value, deposit: NearToken) -> R {
        assert!(
            self.call(who, method, args.clone(), deposit).await?,
            "{method}({args}) should succeed"
        );
        Ok(())
    }
    async fn fails(&self, who: &AccountId, method: &str, args: Value, deposit: NearToken) -> R {
        assert!(
            !self.call(who, method, args.clone(), deposit).await?,
            "{method}({args}) should FAIL"
        );
        Ok(())
    }
    async fn view(&self, method: &str, args: Value) -> R<Value> {
        Ok(near_api::Contract(self.contract.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }
    async fn claim(&self, id: u64) -> R<Value> {
        self.view("get_claim", json!({"claim_id": id})).await
    }
    async fn balance(&self, who: &AccountId) -> R<u128> {
        Ok(near_api::Account(who.clone())
            .tokens()
            .near_balance()
            .fetch_from(&self.net)
            .await?
            .total
            .as_yoctonear())
    }
    /// Alice posts a 1-minute call staking `stake` NEAR. Returns (id, net stake in yocto).
    async fn create(&self, stake: u128) -> R<(u64, u128)> {
        let id = self
            .view("get_claims_count", json!({}))
            .await?
            .as_u64()
            .unwrap();
        self.ok(
            &self.alice,
            "create_claim",
            json!({"text": "$NEAR 2x by Friday", "duration_minutes": 1, "x_handle": "0xZiggy_eth"}),
            NearToken::from_near(stake),
        )
        .await?;
        let c = self.claim(id).await?;
        Ok((id, yocto(&c["stake"])))
    }
    async fn fade(&self, who: &AccountId, id: u64, milli: u128) -> R<u128> {
        let before = yocto(&self.claim(id).await?["total_faded"]);
        self.ok(
            who,
            "fade",
            json!({"claim_id": id}),
            NearToken::from_millinear(milli),
        )
        .await?;
        Ok(yocto(&self.claim(id).await?["total_faded"]) - before)
    }
    async fn pass_deadline(&self) -> R {
        // sandbox blocks are ~1s apart in timestamp terms when fast-forwarded
        self.sandbox.fast_forward(200).await?;
        Ok(())
    }
}

fn yocto(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

const GAS_SLACK: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
const ZERO: NearToken = NearToken::from_yoctonear(0);

fn assert_received(before: u128, after: u128, expected: u128, what: &str) {
    let delta = after as i128 - before as i128;
    assert!(
        delta <= expected as i128 && delta >= expected as i128 - GAS_SLACK as i128,
        "{what}: balance changed by {delta}, expected ~{expected}"
    );
}

#[tokio::test]
async fn happy_w_path() -> R {
    let e = setup().await?;
    let (id, stake) = e.create(2).await?;
    let fb = e.fade(&e.bob, id, 1000).await?;
    let fc = e.fade(&e.carol, id, 500).await?;
    let a0 = e.balance(&e.alice).await?;
    e.ok(
        &e.alice,
        "resolve",
        json!({"claim_id": id, "outcome": "W"}),
        ZERO,
    )
    .await?;
    let a1 = e.balance(&e.alice).await?;
    assert_received(a0, a1, stake + fb + fc, "caller W payout");
    assert_eq!(e.claim(id).await?["status"], "Won");
    e.fails(&e.bob, "collect", json!({"claim_id": id}), ZERO)
        .await?;
    let p = e
        .view("get_profile", json!({"account_id": e.alice}))
        .await?;
    assert_eq!(
        (p["wins"].as_u64(), p["losses"].as_u64()),
        (Some(1), Some(0))
    );
    Ok(())
}

#[tokio::test]
async fn happy_l_path() -> R {
    let e = setup().await?;
    let (id, stake) = e.create(2).await?;
    let fb = e.fade(&e.bob, id, 1000).await?;
    let fc = e.fade(&e.carol, id, 500).await?;
    let a0 = e.balance(&e.alice).await?;
    e.ok(
        &e.alice,
        "resolve",
        json!({"claim_id": id, "outcome": "L"}),
        ZERO,
    )
    .await?;
    assert_received(
        a0,
        e.balance(&e.alice).await?,
        stake - fb - fc,
        "caller keeps unmatched stake",
    );
    assert_eq!(e.claim(id).await?["status"], "Lost");

    for (who, f) in [(&e.bob, fb), (&e.carol, fc)] {
        let b0 = e.balance(who).await?;
        e.ok(who, "collect", json!({"claim_id": id}), ZERO).await?;
        assert_received(b0, e.balance(who).await?, 2 * f, "fader L payout");
        e.fails(who, "collect", json!({"claim_id": id}), ZERO)
            .await?; // double collect
    }
    let p = e
        .view("get_profile", json!({"account_id": e.alice}))
        .await?;
    assert_eq!(p["losses"].as_u64(), Some(1));
    Ok(())
}

#[tokio::test]
async fn timeout_counts_as_l() -> R {
    let e = setup().await?;
    let (id, stake) = e.create(2).await?;
    let fb = e.fade(&e.bob, id, 1000).await?;
    // too early
    e.fails(&e.carol, "resolve_timeout", json!({"claim_id": id}), ZERO)
        .await?;
    e.pass_deadline().await?;
    // caller can no longer resolve after the deadline
    e.fails(
        &e.alice,
        "resolve",
        json!({"claim_id": id, "outcome": "W"}),
        ZERO,
    )
    .await?;
    let a0 = e.balance(&e.alice).await?;
    e.ok(&e.carol, "resolve_timeout", json!({"claim_id": id}), ZERO)
        .await?;
    let a1 = e.balance(&e.alice).await?;
    assert_eq!(
        a1 - a0,
        stake - fb,
        "caller gets exactly the unmatched stake (carol paid gas)"
    );
    let c = e.claim(id).await?;
    assert_eq!(c["status"], "Ghosted");
    assert_eq!(c["resolved_by"], e.carol.as_str());
    let b0 = e.balance(&e.bob).await?;
    e.ok(&e.bob, "collect", json!({"claim_id": id}), ZERO)
        .await?;
    assert_received(b0, e.balance(&e.bob).await?, 2 * fb, "fader ghost payout");
    let p = e
        .view("get_profile", json!({"account_id": e.alice}))
        .await?;
    assert_eq!(p["ghosted"].as_u64(), Some(1));
    Ok(())
}

#[tokio::test]
async fn no_fade_refund() -> R {
    let e = setup().await?;
    for outcome in ["W", "L"] {
        let (id, stake) = e.create(1).await?;
        let a0 = e.balance(&e.alice).await?;
        e.ok(
            &e.alice,
            "resolve",
            json!({"claim_id": id, "outcome": outcome}),
            ZERO,
        )
        .await?;
        assert_received(a0, e.balance(&e.alice).await?, stake, "no-fade refund");
    }
    Ok(())
}

#[tokio::test]
async fn rejections() -> R {
    let e = setup().await?;
    let (id, stake) = e.create(1).await?;
    // caller can't fade own claim
    e.fails(
        &e.alice,
        "fade",
        json!({"claim_id": id}),
        NearToken::from_millinear(100),
    )
    .await?;
    // over-fade is capped and the excess refunded
    let b0 = e.balance(&e.bob).await?;
    let accepted = e.fade(&e.bob, id, 3000).await?;
    assert_eq!(accepted, stake, "fade capped at stake");
    let spent = b0 - e.balance(&e.bob).await?;
    assert!(
        spent < stake + GAS_SLACK,
        "excess fade refunded (spent {spent})"
    );
    // fully faded
    e.fails(
        &e.carol,
        "fade",
        json!({"claim_id": id}),
        NearToken::from_millinear(100),
    )
    .await?;
    // non-caller resolve rejected
    e.fails(
        &e.bob,
        "resolve",
        json!({"claim_id": id, "outcome": "L"}),
        ZERO,
    )
    .await?;
    // resolve, then double-resolve rejected
    e.ok(
        &e.alice,
        "resolve",
        json!({"claim_id": id, "outcome": "W"}),
        ZERO,
    )
    .await?;
    e.fails(
        &e.alice,
        "resolve",
        json!({"claim_id": id, "outcome": "L"}),
        ZERO,
    )
    .await?;
    e.fails(&e.carol, "resolve_timeout", json!({"claim_id": id}), ZERO)
        .await?;

    // fade after deadline rejected
    let (id2, _) = e.create(1).await?;
    e.pass_deadline().await?;
    e.fails(
        &e.bob,
        "fade",
        json!({"claim_id": id2}),
        NearToken::from_millinear(100),
    )
    .await?;
    // callbacks are private
    e.fails(
        &e.bob,
        "on_payout",
        json!({"claim_id": id2, "account": e.bob, "amount": "1", "payee": "Fader"}),
        ZERO,
    )
    .await?;
    // views
    assert_eq!(
        e.view("list_claims", json!({}))
            .await?
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        e.view("list_profiles", json!({}))
            .await?
            .as_array()
            .unwrap()
            .len(),
        2
    );
    Ok(())
}
