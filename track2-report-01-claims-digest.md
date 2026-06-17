# Track-2 Bug Report #1 — `set-claims-digest` is a write-only sink (no client read path)

## Summary

The contract runtime exposes a `set-claims-digest` host call that lets a contract
write a 32-byte SHA-256 into the CCF (Confidential Consortium Framework) Merkle
ledger leaf for the current transaction. The whole point of that leaf is the
"cluster-signed, no-single-operator-to-trust" guarantee: a client should be able
to pull the leaf back, get the cluster's Merkle proof + signed receipt, and
verify *cryptographically* that the digest it cares about was committed — without
trusting any individual node or the SDK's own claims.

**That read path does not exist in the SDK.** `set-claims-digest` is a one-way
sink: a contract can write the digest, but no client-side API anywhere in
`@terminal3/t3n-sdk` reads the leaf, the Merkle proof, or the receipt back. The
guarantee the digest is supposed to enable is unreachable from the client.

## Impact

- **The advertised trust model collapses to "trust the SDK / trust a node".**
  The reason to anchor a digest in a CCF leaf is so the *cluster's* signature over
  the Merkle root attests to it — that is the "no operator to trust" property. With
  no client read of the leaf/proof/receipt, a client can never independently verify
  that property. It is forced back to trusting whatever a single node says over the
  ordinary RPC, which is exactly the thing the CCF receipt was meant to remove.
- **Writes are unauditable by the party that cares.** A contract author can wire up
  `set-claims-digest` (e.g. to anchor a KYC decision, a payroll batch hash, an audit
  commitment), ship it, and a downstream client / auditor has *no SDK-supported way*
  to fetch and verify that digest. The data is committed but inaccessible.
- **Silent dead feature.** Because nothing reads it, a contract can write a wrong or
  empty digest and no client integration will ever notice — there is no read to fail.

## Reproduction

### 1. Grep the shipped SDK type defs (verified)

Searched the entire installed package
`sdk-test/node_modules/@terminal3/t3n-sdk`
case-insensitively for every read-side token:

```
grep -rin -E "claimsDigest|merkleProof|getProof|getReceipt|txProof|merkle" \
  node_modules/@terminal3/t3n-sdk
```

**Result: zero matches. No file, no type, no method.** None of `claimsDigest`,
`merkleProof`, `getProof`, `getReceipt`, `txProof`, or `merkle` appears anywhere in
the package (`dist/index.d.ts`, `dist/index.js`, `dist/index.esm.js`, the WASM
`generated/` interfaces, or the README).

Widening to the underlying concepts is no better — grepping
`dist/index.d.ts` for `ccf|receipt|merkle|proof|leaf` returns only:
- `proof` used in the *auth* sense ("Calls without proof are rejected", line ~1820)
- `attestation` in the TDX/DKG hardware-attestation sense (`verifyTdxQuote`,
  `verifyDkgAttestation`, `fetchDkgAttestation` — node-identity attestation, not
  per-transaction claims-digest receipts)

None of these is a way to read back a transaction's claims-digest leaf or its CCF
Merkle proof/receipt.

The full public export list at `dist/index.d.ts:3188-3189` confirms it: there is no
`getClaimsDigest`, `getProof`, `getReceipt`, `getMerkleProof`, or any equivalent in
either the value exports or the type exports.

The closest existing reads are explicitly *not* this:
- `DataGetResponse` (`dist/index.d.ts:827`) — the single-entry read — returns only
  `{ entry_id: string; payload_hex: string }`. No digest, no proof, no receipt, no
  root, no leaf index.
- `DataListResponse` (`dist/index.d.ts:816`) — returns `entry_ids` / `next_offset` /
  `total`. Again no proof material.
- `TenantNamespace.claim()` (`dist/index.d.ts:3099`) is the tenant *self-admit* claim,
  unrelated to a claims-digest leaf — and it returns `Promise<unknown>` with no proof
  shape.
- `AuditBatch.committed` (`dist/index.d.ts:998-1004`) is a host-stamped boolean
  ("did the dispatch commit?"), not a verifiable cluster receipt — the client still
  has to *trust* that boolean.

### 2. A contract that writes a digest the client cannot read back

```rust
// inside a contract dispatch
fn on_kyc_approved(decision: &KycDecision) {
    // SHA-256 over the canonical decision payload
    let digest: [u8; 32] = sha256(&canonical_bytes(decision));
    // write it into the CCF Merkle leaf for this tx — succeeds
    host::set_claims_digest(&digest);
    // ... commit ...
}
```

Client side, the integrator wants to verify that anchored digest:

```ts
import { T3nClient } from "@terminal3/t3n-sdk";

const client = new T3nClient(/* ... */);

// Execute / read the KYC contract result
const res = await client.dataGet({ /* scope, entry */ });
// res = { entry_id, payload_hex }  -> the payload, but:

//  There is NO method to fetch the claims-digest leaf for that tx.
//  There is NO method to fetch the CCF Merkle proof.
//  There is NO method to fetch the cluster-signed receipt.
client.getClaimsDigest?.(...)   // does not exist
client.getProof?.(...)          // does not exist
client.getReceipt?.(...)        // does not exist
```

There is no API to land on. The digest is committed inside the cluster and is
unreachable from any client built on this SDK.

## Concrete Fix (code change required)

Expose a client-side read path for the claims-digest leaf and its CCF proof.
Concretely, add to `T3nClient` (and mirror on `TenantClient`):

```ts
/** A cluster-signed CCF receipt proving a claims-digest leaf was committed. */
interface ClaimsDigestReceipt {
  /** The 32-byte SHA-256 the contract wrote, hex-encoded. */
  claimsDigest: string;
  /** CCF Merkle proof from the leaf up to the signed root. */
  merkleProof: { leafHash: string; path: { left: boolean; hash: string }[] };
  /** Signed root + service identity, verifiable offline against the cluster cert. */
  receipt: { signature: string; root: string; serviceCert: string };
  /** Transaction coordinates of the committed leaf. */
  txId: string; // CCF seqno/view
}

class T3nClient {
  /** Read back the claims-digest leaf and its cluster-signed CCF proof. */
  getClaimsDigest(txId: string): Promise<ClaimsDigestReceipt>;
}
```

Plus a pure verifier (mirroring the existing `verifyTdxQuote` / `verifyDkgAttestation`
offline-verification pattern already in the SDK) so the client never has to trust a
node's word:

```ts
/** Verify a CCF receipt offline against the cluster service cert. */
declare function verifyClaimsDigestReceipt(
  receipt: ClaimsDigestReceipt,
  serviceCert: string,
): Promise<boolean>;
```

Wiring this up — a `getClaimsDigest`/`getProof`/`getReceipt` read plus an offline
`verifyClaimsDigestReceipt` — closes the loop so a client can independently confirm
the cluster committed the digest it cares about, which is the entire purpose of
writing it into the CCF leaf in the first place.

## Classification

Track 2 — reproduction-backed, code-fix-required. The asymmetry (write host call
present, read API absent) is verifiable by the grep above and makes the
cluster-signed / no-operator-to-trust guarantee unreachable from any client.
