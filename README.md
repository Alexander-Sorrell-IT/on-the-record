# Terminal 3 — Entry Index

This repository contains one submission entry. Everything that ships is under
[`on-the-record/`](on-the-record/).

## The submission: On the Record — THE RECEIPT

An agent runtime where **acting** and **producing tamper-evident evidence of the
act** are *one atomic in-enclave transaction*. There is no separate logging step
that can drift, lie, or be skipped: the receipt **is** the action. Proven on the
Terminal 3 testnet, and reproducible end-to-end **offline** — no network, no
SDK, no credits.

## Reproduce it offline in 30 seconds

One command runs the whole narrated proof and exits `0` (pure Node, built-in
`crypto` only):

```bash
node on-the-record/demo.mjs
```

It walks five sections — act + evidence as one transaction, tamper-evidence,
cross-anchor (no single point of failure), the keyless agent, and the audit
filing — recomputing every receipt hash from a public salt against real
testnet-captured exports.

## Where to look

- **Submission entry / canonical writeup:** [`on-the-record/README.md`](on-the-record/README.md)
- **Submission manifest (what shipped, claims, judging axes):** [`on-the-record/SUBMISSION.md`](on-the-record/SUBMISSION.md)
- **Provenance & lineage disclosure:** [`PROVENANCE.md`](PROVENANCE.md)
- **Track-2 bug report #1 (claims-digest read-path gap):** [`track2-report-01-claims-digest.md`](track2-report-01-claims-digest.md)
- **Demo video script:** [`on-the-record/VIDEO_SCRIPT.md`](on-the-record/VIDEO_SCRIPT.md)

## Honest framing

The guarantee is a category, not a percentage: a released, offline-reproducible
receipt runtime where acting and proving are one transaction. Limits are stated
plainly in the submission — it is tamper-**evident**, not tamper-**proof**; the
cross-anchor is the mechanism demonstrated with two accounts under our control
(full independence holds when third parties run the anchors); and no
"cluster-signed" claim is made, because the SDK read path for it is absent (filed
as Track-2 #1).
