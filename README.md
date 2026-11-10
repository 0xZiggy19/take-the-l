# Take the L

A public, on-chain ledger of crypto-Twitter calls with skin in the game. Built for NEAR HACKATHON 2026.

> Phase 1: smart contract, tests and a live testnet deployment. The web app and the full judge README come next.

- Contract (testnet): `takethel-eadf0a.testnet`
- Contract design and payout rules: [docs/DESIGN.md](docs/DESIGN.md)
- Recorded testnet run with explorer links: [docs/testnet-demo.md](docs/testnet-demo.md)

## Build & test

Requires Rust (the toolchain is pinned in `rust-toolchain.toml`), [cargo-near](https://github.com/near/cargo-near) and [near-cli-rs](https://github.com/near/near-cli-rs).

```bash
cargo near build non-reproducible-wasm   # -> target/near/take_the_l.wasm
cargo test --lib                          # unit tests
cargo test --test integration -- --test-threads=2   # sandbox integration tests (downloads near-sandbox)
```

## Re-run the testnet demo

```bash
for n in caller fader1 fader2; do
  near account create-account sponsor-by-faucet-service $n-<you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
done
CONTRACT=takethel-eadf0a.testnet CALLER=caller-<you>.testnet FADER1=fader1-<you>.testnet FADER2=fader2-<you>.testnet ./scripts/demo-testnet.sh
```

## License

MIT
