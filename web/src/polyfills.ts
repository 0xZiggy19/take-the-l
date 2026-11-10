// Browser shims for wallet libraries. This module must be the first import in main.tsx.
//
// near-api-js and the NEAR Wallet Selector modules (MyNearWallet, Meteor, HOT) call a global `Buffer` when they
// build, serialize and sign transactions (e.g. `Buffer.from(JSON.stringify(args))`). Node has that global; browsers
// don't, so every Fade / Create / W / L / Collect failed with "Buffer is not defined" (Chrome) or
// "Can't find variable: Buffer" (Safari/iOS). We install the `buffer` package's implementation before any wallet
// code is loaded. Wallet modules are imported lazily, so this always runs first.
import { Buffer } from "buffer";

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === "undefined") g.Buffer = Buffer;

export {};
