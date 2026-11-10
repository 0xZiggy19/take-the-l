#!/usr/bin/env bash
# Take the L + Sputnik DAO on NEAR testnet: a community "fade fund".
#
# 1. FADER1 creates a Sputnik DAO (council = FADER1 + FADER2) through the sputnikv2.testnet factory.
# 2. CALLER posts a call.
# 3. The DAO fades it: a FunctionCall proposal to `fade`, both council members vote, the DAO pays.
# 4. CALLER takes the L.
# 5. The DAO collects 2x back into its treasury: a FunctionCall proposal to `collect`, two votes.
# 6. The DAO makes its own call (proposal to `create_claim`) that stays LIVE, so anyone can fade it.
#
# Usage: CONTRACT=... CALLER=... FADER1=... FADER2=... [DAO_NAME=ttlcrew-xyz] ./scripts/dao-demo.sh
# Keys are read from ~/.near-credentials (legacy keychain); nothing secret lives in this repo.
set -uo pipefail
CONTRACT=${CONTRACT:?} CALLER=${CALLER:?} FADER1=${FADER1:?} FADER2=${FADER2:?}
FACTORY=${FACTORY:-sputnikv2.testnet}
DAO_NAME=${DAO_NAME:-ttlcrew-$(date +%s | tail -c 6)}
DAO=$DAO_NAME.$FACTORY
OUT=${OUT:-dao-demo.log}
: > "$OUT"
b64() { printf '%s' "$1" | base64 -w0; }

tx() { # label signer receiver method json deposit gas
  local label=$1 signer=$2 recv=$3 method=$4 args=$5 dep=${6:-0 NEAR} gas=${7:-100.0 Tgas}
  local out id status reason
  out=$(near contract call-function as-transaction "$recv" "$method" json-args "$args" \
        prepaid-gas "$gas" attached-deposit "$dep" sign-as "$signer" \
        network-config testnet sign-with-legacy-keychain send 2>&1)
  id=$(grep -oE 'Transaction ID: [A-Za-z0-9]+' <<<"$out" | head -1 | awk '{print $3}')
  if grep -qiE 'Error|failed' <<<"$out"; then status=FAILED; else status=OK; fi
  reason=$(grep -oE 'Smart contract panicked: [^"]*' <<<"$out" | head -1)
  printf '%s | %s | %s | https://testnet.nearblocks.io/txns/%s %s\n' "$status" "$label" "$signer → $recv.$method" "$id" "$reason" | tee -a "$OUT"
  LAST_OUT=$out
}
view() { near contract call-function as-read-only "$1" "$2" json-args "$3" network-config testnet now 2>/dev/null; }
count() { view "$CONTRACT" get_claims_count '{}' | grep -oE '^[0-9]+' | tail -1; }
last_proposal() { view "$DAO" get_last_proposal_id '{}' | grep -oE '^[0-9]+' | tail -1; }

# propose_call <label> <method> <json args> <yocto deposit>: add a FunctionCall proposal, both council members approve.
propose_call() {
  local label=$1 method=$2 args=$3 dep=$4
  local kind="{\"FunctionCall\":{\"receiver_id\":\"$CONTRACT\",\"actions\":[{\"method_name\":\"$method\",\"args\":\"$(b64 "$args")\",\"deposit\":\"$dep\",\"gas\":\"150000000000000\"}]}}"
  tx "DAO proposal: $label" "$FADER1" "$DAO" add_proposal "{\"proposal\":{\"description\":\"$label\",\"kind\":$kind}}" "$BOND_NEAR" '100.0 Tgas'
  local pid=$(( $(last_proposal) - 1 ))
  tx "vote 1/2 on proposal #$pid" "$FADER1" "$DAO" act_proposal "{\"id\":$pid,\"action\":\"VoteApprove\",\"proposal\":$kind}" '0 NEAR' '300.0 Tgas'
  tx "vote 2/2 on proposal #$pid (executes)" "$FADER2" "$DAO" act_proposal "{\"id\":$pid,\"action\":\"VoteApprove\",\"proposal\":$kind}" '0 NEAR' '300.0 Tgas'
  view "$DAO" get_proposal "{\"id\":$pid}" | grep -E '"status"' | tee -a "$OUT"
}

echo "== 1. Create the DAO $DAO (council: $FADER1, $FADER2)" | tee -a "$OUT"
DAO_ARGS="{\"config\":{\"name\":\"$DAO_NAME\",\"purpose\":\"Take the L fade fund: members vote on which CT calls to fade\",\"metadata\":\"\"},\"policy\":[\"$FADER1\",\"$FADER2\"]}"
tx "create DAO" "$FADER1" "$FACTORY" create "{\"name\":\"$DAO_NAME\",\"args\":\"$(b64 "$DAO_ARGS")\"}" '7 NEAR' '300.0 Tgas'
BOND=$(view "$DAO" get_policy '{}' | grep -oE '"proposal_bond": *"[0-9]+"' | grep -oE '[0-9]+')
BOND_NEAR="$(python3 -c "print($BOND/1e24)") NEAR"
echo "   proposal bond: $BOND_NEAR" | tee -a "$OUT"

echo "== 2. $CALLER posts a call" | tee -a "$OUT"
C=$(count)
tx "create claim #$C" "$CALLER" "$CONTRACT" create_claim '{"text":"$NEAR flips $SOL by Sunday","duration_minutes":30,"x_handle":"0xZiggy_eth"}' '1 NEAR'

echo "== 3. The DAO votes to fade it with 0.5 NEAR" | tee -a "$OUT"
propose_call "Fade call #$C with 0.5 NEAR" fade "{\"claim_id\":$C}" 500000000000000000000000
view "$CONTRACT" get_claim "{\"claim_id\":$C}" | grep -E '"fader"|"total_faded"' | tee -a "$OUT"

echo "== 4. Caller takes the L" | tee -a "$OUT"
tx "resolve #$C L" "$CALLER" "$CONTRACT" resolve "{\"claim_id\":$C,\"outcome\":\"L\"}"

echo "== 5. The DAO votes to collect its 2x winnings into the treasury" | tee -a "$OUT"
view "$CONTRACT" get_claimable "{\"claim_id\":$C,\"account_id\":\"$DAO\"}" | tail -1 | sed 's/^/   claimable before: /' | tee -a "$OUT"
propose_call "Collect winnings from call #$C" collect "{\"claim_id\":$C}" 0
view "$CONTRACT" get_claimable "{\"claim_id\":$C,\"account_id\":\"$DAO\"}" | tail -1 | sed 's/^/   claimable after: /' | tee -a "$OUT"

echo "== 6. The DAO makes its own community call (stays LIVE for 14 days, anyone can fade it)" | tee -a "$OUT"
D=$(count)
propose_call "Community call #$D: NEAR above \$5 before Dec 1" create_claim '{"text":"Community call: $NEAR above $5 before Dec 1","duration_minutes":20160}' 1000000000000000000000000
view "$CONTRACT" get_claim "{\"claim_id\":$D}" | grep -E '"caller"|"status"' | tee -a "$OUT"
view "$CONTRACT" get_profile "{\"account_id\":\"$DAO\"}" | tee -a "$OUT"
echo "DAO: https://testnet.nearblocks.io/address/$DAO" | tee -a "$OUT"
