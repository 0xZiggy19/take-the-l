# Testnet demo run (2026-11-10)

Contract: [takethel-eadf0a.testnet](https://testnet.nearblocks.io/address/takethel-eadf0a.testnet). Caller: caller-eadf0a.testnet. Faders: fader1-eadf0a.testnet, fader2-eadf0a.testnet.
Deploy + init tx: https://testnet.nearblocks.io/txns/B6T7dxFKCS4xBZvukc5NqVTu2ho3sSLdBR1bcArtwGp3

Produced by `scripts/demo-testnet.sh`. Rows marked FAILED are deliberate rejection checks.

```
== 1. W path: caller stakes 1 NEAR, two faders, caller marks W
OK | create claim #0 | caller-eadf0a.testnet.create_claim | https://testnet.nearblocks.io/txns/J2FghgxHic29D3UmaMr5tt56UeCJ1erNssF1LUL1Yabq 
OK | fade #0 0.5 | fader1-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/F1n6sLHsPQWqv5KbAynyZC6X4QXZFMBWPmoLn7mSqyxd 
OK | fade #0 0.3 | fader2-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/BaDGSEPraHkrx2zEoqyR269eqBFRKcJLpUBKws7E1zPs 
OK | resolve #0 W (caller paid stake+fades) | caller-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/BHcHcLb4D7qioxJmPFt9oDcE3iRipicSS2yZKBtVfqJt 
FAILED | REJECT double resolve #0 | caller-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/HKHEA6EuswWX4FKqSJGCdnLs2CfXce8D73ycFRF4DNLJ Smart contract panicked: Claim is already resolved
FAILED | REJECT fader collect after W #0 | fader1-eadf0a.testnet.collect | https://testnet.nearblocks.io/txns/H2LWr7DopXrGsZASitmAS6sHSCufLvCUhoLDELwdPP8g Smart contract panicked: The caller won this one: nothing to collect
== 2. L path: over-fade gets capped+refunded, caller takes the L, faders collect 2x
OK | create claim #1 | caller-eadf0a.testnet.create_claim | https://testnet.nearblocks.io/txns/D1V4mw3soaqxXfVoezHuiXHSUcpmkHJ9EGYgufn6q68a 
FAILED | REJECT caller fades own claim #1 | caller-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/Hwf6RKfrZU5DmYzZUehtvcVvbyp2Xn5WAdJCMboT82FE Smart contract panicked: You can't fade your own call
OK | fade #1 0.4 | fader1-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/DYAn5NP1VhijX9KDFSdiGC4BptYbkfmpoMVXkx4k7vW1 
OK | fade #1 0.7 (capped, excess refunded) | fader2-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/5uYsQaA8yLu1kgp96yyhDAVct18Av3CcYuhaWK6cdQay 
FAILED | REJECT non-caller resolve #1 | fader1-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/Ge2WpT8eQXYm4bnsasvH7x9xMeWYfEFdyJWJhR6Jv9MX Smart contract panicked: Only the caller can resolve this call
OK | resolve #1 L (caller gets unmatched back) | caller-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/4psS53Y1gh2osErDACCfsW3D5NsGhDAgApVHudsSMqz3 
OK | collect #1 fader1 (2x) | fader1-eadf0a.testnet.collect | https://testnet.nearblocks.io/txns/BWR8PC2eMUgRhDVqDxQqdqXWyrfGtwSCtrAcWknj8kf8 
OK | collect #1 fader2 (2x) | fader2-eadf0a.testnet.collect | https://testnet.nearblocks.io/txns/CF8yRNtHUzSNKTybJfLGQzD6Zga7eWjCx1TG7Zz3NV5o 
== 3. No-fade refund
OK | create claim #2 | caller-eadf0a.testnet.create_claim | https://testnet.nearblocks.io/txns/RsJz8DZedbYhBDafePXiSEb7wPx3FguLLU7Bke4E2gE 
OK | resolve #2 L, no faders -> full refund | caller-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/EpvtZ8UzFd79Szi7huU8DYyyQeNUeYstvybV3fTijxyj 
== 4. Ghosted: caller goes silent, anyone settles it as an L
OK | create claim #3 (1 min) | caller-eadf0a.testnet.create_claim | https://testnet.nearblocks.io/txns/JDzQCe6TvoG14qtDmQnHXV5j1ihtGpyQdU6j6oYVboBo 
OK | fade #3 0.5 | fader1-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/4C5WpuUWRrYEKmim1KjeRusGjFXPak7VC1xEGSWpYwXk 
FAILED | REJECT early timeout #3 | fader2-eadf0a.testnet.resolve_timeout | https://testnet.nearblocks.io/txns/AmZtz14ne5azF4ceCRFbY8zmCnxZRHdb4WLzN4zDxcxX Smart contract panicked: Deadline has not passed yet
FAILED | REJECT fade after deadline #3 | fader2-eadf0a.testnet.fade | https://testnet.nearblocks.io/txns/HgG5FMzJ7W8quAmaZAh8RyhZUbWSj7JvJ6HmHXtmDM9i Smart contract panicked: Claim deadline has passed, fading is closed
FAILED | REJECT caller resolve after deadline #3 | caller-eadf0a.testnet.resolve | https://testnet.nearblocks.io/txns/CbNurxzUCLYeH2emzEJCYRDC3fFjGZTSpKm5MviL7a5U Smart contract panicked: Deadline passed: the call can only be settled with resolve_timeout (as an L)
OK | resolve_timeout #3 by fader2 -> Ghosted | fader2-eadf0a.testnet.resolve_timeout | https://testnet.nearblocks.io/txns/DTupYyVx8uF34EheawmdBDqus1gPbzD7ZLkeRBKhw3XB 
OK | collect #3 fader1 (2x) | fader1-eadf0a.testnet.collect | https://testnet.nearblocks.io/txns/38XrHuHbZVY4vYrne6LforGWkqiQTKv74tmw1ZSzgfrV 
== Scoreboard
{
  "calls": 4,
  "fades": 0,
  "ghosted": 1,
  "losses": 2,
  "total_faded": "0",
  "total_staked": "3490030000000000000000000",
  "wins": 1
}
[
  {
    "account_id": "caller-eadf0a.testnet",
    "calls": 4,
    "fades": 0,
    "ghosted": 1,
    "losses": 2,
    "total_faded": "0",
    "total_staked": "3490030000000000000000000",
    "wins": 1
  },
  {
    "account_id": "fader1-eadf0a.testnet",
    "calls": 0,
    "fades": 3,
    "ghosted": 0,
    "losses": 0,
    "total_faded": "1395810000000000000000000",
    "total_staked": "0",
    "wins": 0
  },
  {
    "account_id": "fader2-eadf0a.testnet",
    "calls": 0,
    "fades": 2,
    "ghosted": 0,
    "losses": 0,
    "total_faded": "895490000000000000000000",
    "total_staked": "0",
    "wins": 0
  }
]
```
