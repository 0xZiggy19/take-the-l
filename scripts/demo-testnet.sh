#!/usr/bin/env bash
# End-to-end demo of Take the L on NEAR testnet.
# Usage: CONTRACT=takethel-xxxx.testnet CALLER=... FADER1=... FADER2=... ./scripts/demo-testnet.sh
# Keys are read from ~/.near-credentials (legacy keychain); nothing secret lives in this repo.
set -uo pipefail
CONTRACT=${CONTRACT:?} CALLER=${CALLER:?} FADER1=${FADER1:?} FADER2=${FADER2:?}
OUT=${OUT:-demo-testnet.log}
: > "$OUT"

call() { # label signer method json deposit
  local label=$1 signer=$2 method=$3 args=$4 dep=${5:-0 NEAR}
  local out tx status
  out=$(near contract call-function as-transaction "$CONTRACT" "$method" json-args "$args" \
        prepaid-gas '100.0 Tgas' attached-deposit "$dep" sign-as "$signer" \
        network-config testnet sign-with-legacy-keychain send 2>&1)
  tx=$(grep -oE 'Transaction ID: [A-Za-z0-9]+' <<<"$out" | head -1 | awk '{print $3}')
  if grep -qiE 'Error|failed' <<<"$out"; then status=FAILED; else status=OK; fi
  local reason; reason=$(grep -oE 'Smart contract panicked: [^"]*' <<<"$out" | head -1)
  printf '%s | %s | %s | https://testnet.nearblocks.io/txns/%s %s\n' "$status" "$label" "$signer.$method" "$tx" "$reason" | tee -a "$OUT"
}
view() { near contract call-function as-read-only "$CONTRACT" "$1" json-args "$2" network-config testnet now 2>/dev/null; }
count() { view get_claims_count '{}' | grep -oE '^[0-9]+' | tail -1; }

echo "== 1. W path: caller stakes 1 NEAR, two faders, caller marks W" | tee -a "$OUT"
W=$(count)
call "create claim #$W" "$CALLER" create_claim '{"text":"$NEAR 2x by Friday","duration_minutes":30,"x_handle":"0xZiggy_eth"}' '1 NEAR'
call "fade #$W 0.5" "$FADER1" fade "{\"claim_id\":$W}" '0.5 NEAR'
call "fade #$W 0.3" "$FADER2" fade "{\"claim_id\":$W}" '0.3 NEAR'
call "resolve #$W W (caller paid stake+fades)" "$CALLER" resolve "{\"claim_id\":$W,\"outcome\":\"W\"}"
call "REJECT double resolve #$W" "$CALLER" resolve "{\"claim_id\":$W,\"outcome\":\"L\"}"
call "REJECT fader collect after W #$W" "$FADER1" collect "{\"claim_id\":$W}"

echo "== 2. L path: over-fade gets capped+refunded, caller takes the L, faders collect 2x" | tee -a "$OUT"
L=$(count)
call "create claim #$L" "$CALLER" create_claim '{"text":"$BTC 150k by Sunday","duration_minutes":30,"x_handle":"0xZiggy_eth"}' '1 NEAR'
call "REJECT caller fades own claim #$L" "$CALLER" fade "{\"claim_id\":$L}" '0.1 NEAR'
call "fade #$L 0.4" "$FADER1" fade "{\"claim_id\":$L}" '0.4 NEAR'
call "fade #$L 0.7 (capped, excess refunded)" "$FADER2" fade "{\"claim_id\":$L}" '0.7 NEAR'
call "REJECT non-caller resolve #$L" "$FADER1" resolve "{\"claim_id\":$L,\"outcome\":\"L\"}"
call "resolve #$L L (caller gets unmatched back)" "$CALLER" resolve "{\"claim_id\":$L,\"outcome\":\"L\"}"
call "collect #$L fader1 (2x)" "$FADER1" collect "{\"claim_id\":$L}"
call "collect #$L fader2 (2x)" "$FADER2" collect "{\"claim_id\":$L}"

echo "== 3. No-fade refund" | tee -a "$OUT"
N=$(count)
call "create claim #$N" "$CALLER" create_claim '{"text":"$NEAR ETF approved this year","duration_minutes":30}' '0.5 NEAR'
call "resolve #$N L, no faders -> full refund" "$CALLER" resolve "{\"claim_id\":$N,\"outcome\":\"L\"}"

echo "== 4. Ghosted: caller goes silent, anyone settles it as an L" | tee -a "$OUT"
G=$(count)
call "create claim #$G (1 min)" "$CALLER" create_claim '{"text":"$NEAR flips $SOL this week","duration_minutes":1,"x_handle":"0xZiggy_eth"}' '1 NEAR'
call "fade #$G 0.5" "$FADER1" fade "{\"claim_id\":$G}" '0.5 NEAR'
call "REJECT early timeout #$G" "$FADER2" resolve_timeout "{\"claim_id\":$G}"
echo "   waiting 70s for the deadline..." ; sleep 70
call "REJECT fade after deadline #$G" "$FADER2" fade "{\"claim_id\":$G}" '0.1 NEAR'
call "REJECT caller resolve after deadline #$G" "$CALLER" resolve "{\"claim_id\":$G,\"outcome\":\"W\"}"
call "resolve_timeout #$G by fader2 -> Ghosted" "$FADER2" resolve_timeout "{\"claim_id\":$G}"
call "collect #$G fader1 (2x)" "$FADER1" collect "{\"claim_id\":$G}"

echo "== Scoreboard" | tee -a "$OUT"
view get_profile "{\"account_id\":\"$CALLER\"}" | tee -a "$OUT"
view list_profiles '{}' | tee -a "$OUT"
