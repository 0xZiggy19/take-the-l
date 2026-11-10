# Sputnik DAO demo run (testnet, 2026-11-10)

Output of `scripts/dao-demo.sh` with `DAO_NAME=ttlcrew`. DAO: [ttlcrew.sputnikv2.testnet](https://testnet.nearblocks.io/address/ttlcrew.sputnikv2.testnet). Council: `fader1-eadf0a.testnet`, `fader2-eadf0a.testnet`; every proposal needs both votes.

```
== 1. Create the DAO ttlcrew.sputnikv2.testnet (council: fader1-eadf0a.testnet, fader2-eadf0a.testnet)
OK | create DAO | fader1-eadf0a.testnet → sputnikv2.testnet.create | https://testnet.nearblocks.io/txns/ANC882bQctxUuVwsaXrkdELVr48FdG7NNKN6pwrkPwB7 
   proposal bond: 1.0 NEAR
== 2. caller-eadf0a.testnet posts a call
OK | create claim #10 | caller-eadf0a.testnet → takethel-eadf0a.testnet.create_claim | https://testnet.nearblocks.io/txns/CWMrCuhRhmdn7HRXWQQ4JDWvLXJj2PczBiEKHpZLKEAN 
== 3. The DAO votes to fade it with 0.5 NEAR
OK | DAO proposal: Fade call #10 with 0.5 NEAR | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.add_proposal | https://testnet.nearblocks.io/txns/4cyQpqCUbLwft5h6n5e2LwisZaskpoorYNWjobKRYvjw 
OK | vote 1/2 on proposal #0 | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/GkGhtdZixLVdLwEJG1h1VdHSLYopuRrtbDSS47YaoBzJ 
OK | vote 2/2 on proposal #0 (executes) | fader2-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/BxWYc7ryEURsKG71iWSanLV4rX4EX7gKF8Z9afdGjt6c 
  "status": "Approved",
      "fader": "ttlcrew.sputnikv2.testnet",
  "total_faded": "496690000000000000000000",
== 4. Caller takes the L
OK | resolve #10 L | caller-eadf0a.testnet → takethel-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/2M9QT2Un4fjDFHQUcz14XQchGtPcfiyAq4fCqPUMtk1V 
== 5. The DAO votes to collect its 2x winnings into the treasury
   claimable before: "993380000000000000000000"
OK | DAO proposal: Collect winnings from call #10 | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.add_proposal | https://testnet.nearblocks.io/txns/GF9h1e1QXSHzsm5PDMwdQ18DXRoBNX5PiRrRtCYzByrx 
OK | vote 1/2 on proposal #1 | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/C1RBQxP8N2Qfs9tKVEqrMWdPN28MvvcG8RxFCRHfJwrt 
OK | vote 2/2 on proposal #1 (executes) | fader2-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/BaHGmL7VwF9wjhkUeyfNw7qFWUDs93GGCHkjVHAsT9NT 
  "status": "Approved",
   claimable after: "0"
== 6. The DAO makes its own community call (stays LIVE for 14 days, anyone can fade it)
OK | DAO proposal: Community call #11: NEAR above $5 before Dec 1 | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.add_proposal | https://testnet.nearblocks.io/txns/7DJjfPLEQueSu4U59maURUQNSTdrnVUu4Ys8kcFVRxPo 
OK | vote 1/2 on proposal #2 | fader1-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/3RAiRi9yndmwhthK7MZf4f5iiV6dDwexiGrt8LoR8j28 
OK | vote 2/2 on proposal #2 (executes) | fader2-eadf0a.testnet → ttlcrew.sputnikv2.testnet.act_proposal | https://testnet.nearblocks.io/txns/6EfZifBswtQUBP3kUkTh1CbzAYWayHfv8qxbtCYwqvuP 
  "status": "Approved",
  "caller": "ttlcrew.sputnikv2.testnet",
  "status": "Open",
{
  "calls": 1,
  "fades": 1,
  "ghosted": 0,
  "losses": 0,
  "total_faded": "496690000000000000000000",
  "total_staked": "997310000000000000000000",
  "wins": 0
}
DAO: https://testnet.nearblocks.io/address/ttlcrew.sputnikv2.testnet
```
