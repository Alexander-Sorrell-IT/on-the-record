# Regulator / Audit Filing — Receipt Chain Logging Extract

_Loosely modeled on an EU AI Act Article 12 (record-keeping) logging extract plus a plain audit pack._

| Field | Value |
| --- | --- |
| System | On the Record — grant-checked action receipt ledger |
| Tenant DID (derived from public salt) | `did:t3n:01882ebbf599fcbfc9c6cc562ea4ce7d93135773` |
| Domain-separation salt (public) | `on-the-record:v1:01882ebbf599fcbfc9c6cc562ea4ce7d93135773` |
| Chain head hash | `22eef927bbd43d64c147103da4027a00772ac161aa08c9640d213ff44d37d61a` |
| Receipt rows in filing | 2 |
| Verification status | CHAIN OK (2 rows, recomputed client-side) |
| Generated from | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export.json` |
| Generated at (UTC) | 2026-06-16T22:20:53.690Z |

> Evidence model: each row's `hash = SHA256( salt || prev_hash_bytes || canonical_json(row\ hash) )`. Each entry below CITES its own evidence hash and its `prev_hash` link to the prior row, so every line is independently traceable along the salted hash-chain back to genesis (`prev_hash = 0000000000000000000000000000000000000000000000000000000000000000`).

---

## Receipt Entries

### Entry 1 — receipt seq 29263

- **Sequence:** 29263
- **Timestamp:** 2026-06-13T17:28:55.000Z (unix 1781371735)
- **Actor DID:** `did:t3n:3f6988bd4faa2548af798e9f1004b57f8fa1fe19`
- **Action:** transfer:invoice-7782
- **Decision:** ALLOWED
- **Masked secret proof:** `sk_l…****…2a7c` (masked — full secret never leaves the boundary)
- **Evidence (cited hash):**
  - prev_hash link: `0000000000000000000000000000000000000000000000000000000000000000` (genesis — first row in chain)
  - this row hash: `7ab05ec0d5984c42af7ed52b7aba1680b1e22b489169eeeb630fc7999e93b9a0`

### Entry 2 — receipt seq 29270

- **Sequence:** 29270
- **Timestamp:** 2026-06-13T17:28:56.000Z (unix 1781371736)
- **Actor DID:** `did:t3n:3f6988bd4faa2548af798e9f1004b57f8fa1fe19`
- **Action:** transfer:invoice-7783
- **Decision:** DENIED — reason: no_active_grant
- **Masked secret proof:** (none — no secret was exercised on this action)
- **Evidence (cited hash):**
  - prev_hash link: `7ab05ec0d5984c42af7ed52b7aba1680b1e22b489169eeeb630fc7999e93b9a0` (links to the prior entry above)
  - this row hash: `22eef927bbd43d64c147103da4027a00772ac161aa08c9640d213ff44d37d61a`

---

## Attestation

This filing was rendered only after the full chain (2 rows) was re-verified client-side using the same hash rule as the offline verifier. The chain head `22eef927bbd43d64c147103da4027a00772ac161aa08c9640d213ff44d37d61a` is the cryptographic commitment to all entries above; altering any field of any row would change that row's hash and break the cited `prev_hash` links for every subsequent entry, which the verifier would detect.
