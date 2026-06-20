# Terminal 3 — Entry Index

This repository contains one submission entry. The canonical writeup is
[`on-the-record/README.md`](on-the-record/README.md); the live mesh is under
[`relay-build/`](relay-build/).

## The submission: On the Record — a no-single-point-of-trust agent mesh

A live trust **topology** for multi-agent action. As a task is relayed
agent→agent, the receiving agent reads the sender's **unforgeable `did:t3n`**
inside its own Terminal 3 enclave, re-checks the sender's chain head, and
**mutually cross-anchors** it *before* the work advances. The next verifier is a
**random draw pinned by the chain hash**. Every node both verifies and is
verified, and anyone can re-walk the whole route offline — verification lives in
the **live control path**, not an after-the-fact log. Proven on the Terminal 3
testnet (route A→B→C, every hop caller-verified, both pairs `CROSS-ANCHOR OK`),
and re-checkable end-to-end **offline** — no network, no SDK, no credits.

## Reproduce it offline in 30 seconds

Re-walk the live mesh from the exported chains (pure Node, built-in `crypto`
only):

```bash
node on-the-record/verifier.mjs relay-build/export-A.json   # -> CHAIN OK 17 rows
node on-the-record/verifier.mjs --cross relay-build/export-A.json relay-build/export-B.json  # -> CROSS-ANCHOR OK
node on-the-record/verifier.test.mjs                        # -> ALL TESTS PASSED (36 checks)
```

The receipt **proof layer** underneath the mesh has its own one-command demo
(act + evidence as one transaction, tamper-evidence, the keyless agent):

```bash
node on-the-record/demo.mjs
```

## Where to look

- **Canonical writeup:** [`on-the-record/README.md`](on-the-record/README.md)
- **The live mesh (relay + adversarial beats + exports):** [`relay-build/`](relay-build/)
- **Platform finding — cross-tenant invoke is not 10k-gated:** [`relay-build/boundary-evidence.txt`](relay-build/boundary-evidence.txt)
- **Provenance & lineage disclosure:** [`PROVENANCE.md`](PROVENANCE.md)
- **Track-2 bug report #1 (claims-digest read-path gap):** [`track2-report-01-claims-digest.md`](track2-report-01-claims-digest.md)

## Honest framing

The guarantee is a category, not a percentage. With three same-owner accounts the
mesh demonstrates the **mechanism** of committed, recomputable, non-retro-rollable
random selection — the property that scales to statistical non-collusion at large
N; we do **not** claim "a jury of strangers." It is tamper-**evident**, not
tamper-**proof**; the cross-anchor binds each pair up to its last mutual seal; and
no "cluster-signed" claim is made (the SDK read path for it is absent — filed as
Track-2 #1).
