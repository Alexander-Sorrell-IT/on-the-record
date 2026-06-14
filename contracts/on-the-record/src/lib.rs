//! on-the-record — the receipt-runtime TEE contract.
//!
//! Every decision the contract makes is appended to a contract-only audit
//! trail as a SALTED HASH-CHAINED row:
//!   * caller identity comes from `tenant_context::calling_user_did()`
//!     (unforgeable — not the request body),
//!   * any secret is read INSIDE the enclave and only a masked proof leaves
//!     the WIT boundary,
//!   * each row carries `prev_hash` + `hash`, so the trail is offline-verifiable
//!     from a PUBLIC per-tenant salt (domain separation, NOT a secret).
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

use alloc::string::{String, ToString};
#[cfg(target_arch = "wasm32")]
use alloc::vec::Vec;

wit_bindgen::generate!({
    world: "on-the-record",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{kv_store, logging},
    tenant::tenant_context,
};

struct Component;

// ----------------------------------------------------------------------------
// chain — PURE hashing / canonicalization. No host imports, no target gating,
// so the native `cargo test` target exercises exactly the wasm code path.
// ----------------------------------------------------------------------------
mod chain {
    use super::*;
    use alloc::collections::BTreeMap;
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    /// `prev_hash` for the genesis row (seq-0 tail): 64 hex zeros (32 zero bytes).
    pub const GENESIS_PREV_HASH: &str =
        "0000000000000000000000000000000000000000000000000000000000000000";

    /// Deterministic, sorted-keys serialization of a JSON value. Object keys are
    /// emitted in ascending byte order; arrays keep their order. No insignificant
    /// whitespace, so two semantically-equal records canonicalize identically.
    pub fn canonical_json(v: &Value) -> String {
        let mut out = String::new();
        write_canonical(v, &mut out);
        out
    }

    fn write_canonical(v: &Value, out: &mut String) {
        match v {
            Value::Object(map) => {
                // sorted keys — BTreeMap gives ascending order deterministically.
                let sorted: BTreeMap<&String, &Value> = map.iter().collect();
                out.push('{');
                let mut first = true;
                for (k, val) in sorted {
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    // serde_json on a String yields a correctly-escaped JSON
                    // string literal (quotes + escapes).
                    out.push_str(&Value::String(k.clone()).to_string());
                    out.push(':');
                    write_canonical(val, out);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                let mut first = true;
                for item in items {
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    write_canonical(item, out);
                }
                out.push(']');
            }
            // Scalars: serde_json already emits a canonical form for
            // string/number/bool/null.
            other => out.push_str(&other.to_string()),
        }
    }

    /// hash = hex( SHA256( salt_bytes || prev_hash_bytes(hex-decoded) ||
    ///                     canonical_json(record WITHOUT the hash field) ) )
    ///
    /// `record` is the row object MINUS its `hash` field. `prev_hash` is the
    /// 64-hex tail hash (GENESIS_PREV_HASH for the genesis row).
    pub fn chain_hash(salt: &str, prev_hash: &str, record: &Value) -> String {
        let prev_bytes = hex::decode(prev_hash).unwrap_or_default();
        let canon = canonical_json(record);

        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(&prev_bytes);
        hasher.update(canon.as_bytes());
        hex::encode(hasher.finalize())
    }
}

// ----------------------------------------------------------------------------
// Helpers (wasm-only — they call host imports)
// ----------------------------------------------------------------------------
#[cfg(target_arch = "wasm32")]
mod imp {
    use super::*;
    use alloc::format;
    use serde_json::{json, Map, Value};

    /// PUBLIC per-tenant domain-separation salt. NOT a secret — it is included
    /// in every export so the chain is offline-verifiable. Bound to the tenant
    /// DID so chains from different tenants cannot be spliced together.
    fn chain_salt(tid: &str) -> String {
        format!("on-the-record:v1:{tid}")
    }

    fn tid_hex() -> String {
        hex::encode(tenant_context::tenant_did())
    }

    fn caller_did() -> String {
        match tenant_context::calling_user_did() {
            Some(c) => format!("did:t3n:{}", hex::encode(c)),
            None => "anonymous".to_string(),
        }
    }

    fn kv_get_string(map: &str, key: &[u8]) -> Result<Option<String>, String> {
        match kv_store::get(map, key).map_err(|e| format!("kv get {map}: {e}"))? {
            Some(bytes) => Ok(Some(String::from_utf8(bytes).map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    /// Mask a secret so the caller sees PROOF the contract read it, never the value.
    fn mask(secret: &str) -> String {
        let n = secret.chars().count();
        if n <= 8 {
            return "****".to_string();
        }
        let first: String = secret.chars().take(4).collect();
        let last: String = secret.chars().skip(n - 4).collect();
        format!("{first}\u{2026}****\u{2026}{last}")
    }

    fn audit_write(map: &str, seq: u64, record: &Value) -> Result<(), String> {
        let key = format!("{:020}", seq);
        let val = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        kv_store::put(map, key.as_bytes(), &val).map_err(|e| format!("audit put: {e}"))
    }

    /// Find the chain tail's `hash` by scanning the trail map and SELECTING the
    /// MAX `{:020}` key after sorting ascending in-code. Do NOT trust scan order.
    /// Returns the genesis prev_hash when the trail is empty.
    fn tail_prev_hash(map: &str) -> Result<String, String> {
        let rows = kv_store::scan(map, &[0u8], &[0xffu8], 1000)
            .map_err(|e| format!("trail scan: {e}"))?;

        // The tail is the MAX key. For fixed-width {:020} zero-padded keys,
        // lexicographic order == numeric order, so max_by(cmp) selects the tail
        // regardless of the order `scan` returned.
        let tail = rows.into_iter().max_by(|a, b| a.0.cmp(&b.0));
        match tail {
            None => Ok(chain::GENESIS_PREV_HASH.to_string()),
            Some((_k, v)) => {
                let row: Value =
                    serde_json::from_slice(&v).map_err(|e| format!("tail decode: {e}"))?;
                row.get("hash")
                    .and_then(|h| h.as_str())
                    .map(|s| s.to_string())
                    .ok_or_else(|| "tail row missing hash field".to_string())
            }
        }
    }

    /// Build a chained row, compute its hash, and persist it. Returns the full
    /// row (including `hash`) as JSON bytes for the caller.
    #[allow(clippy::too_many_arguments)]
    fn write_chained_row(
        map: &str,
        salt: &str,
        seq: u64,
        ts: u64,
        caller: &str,
        action: &str,
        outcome: &str,
        masked_secret: &str,
        reason: &str,
    ) -> Result<Vec<u8>, String> {
        let prev_hash = tail_prev_hash(map)?;

        // Record WITHOUT the hash field — this is exactly what gets hashed.
        let mut obj = Map::new();
        obj.insert("seq".to_string(), json!(seq));
        obj.insert("ts".to_string(), json!(ts));
        obj.insert("caller_did".to_string(), json!(caller));
        obj.insert("action".to_string(), json!(action));
        obj.insert("outcome".to_string(), json!(outcome));
        obj.insert("masked_secret".to_string(), json!(masked_secret));
        obj.insert("reason".to_string(), json!(reason));
        obj.insert("prev_hash".to_string(), json!(prev_hash));
        let record = Value::Object(obj);

        let hash = chain::chain_hash(salt, &prev_hash, &record);

        // Append the hash to produce the stored/returned row.
        let mut full = record;
        if let Value::Object(ref mut m) = full {
            m.insert("hash".to_string(), json!(hash));
        }

        audit_write(map, seq, &full)?;
        serde_json::to_vec(&full).map_err(|e| e.to_string())
    }

    pub fn record_action(input: &[u8]) -> Result<Vec<u8>, String> {
        let req: Value =
            serde_json::from_slice(input).map_err(|e| format!("bad request json: {e}"))?;
        let action = req
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let tid = tid_hex();
        let salt = chain_salt(&tid);
        let policy_map = format!("z:{tid}:policy");
        let secrets_map = format!("z:{tid}:secrets");
        let trail_map = format!("z:{tid}:trail");

        let caller = caller_did();
        let ts = tenant_context::cluster_timestamp_secs();
        let seq = tenant_context::seq_no();

        // GRANT MODEL: the caller may act only if policy `grant:<caller_did>` is
        // exactly "active". Missing or "revoked" => DENY. The refusal IS a
        // receipt — it goes through the SAME chained-row path as an allow.
        let grant_key = format!("grant:{caller}");
        let grant = kv_get_string(&policy_map, grant_key.as_bytes())?.unwrap_or_default();
        let allowed = grant == "active";
        let outcome = if allowed { "allowed" } else { "denied" };
        let reason = if allowed { "" } else { "no_active_grant" };

        // Touch a secret ONLY inside the enclave; only a masked proof is recorded.
        let masked_secret = if allowed {
            match kv_get_string(&secrets_map, b"witness")? {
                Some(s) => mask(&s),
                None => String::new(),
            }
        } else {
            String::new()
        };

        let out = write_chained_row(
            &trail_map,
            &salt,
            seq,
            ts,
            &caller,
            &action,
            outcome,
            &masked_secret,
            reason,
        )?;
        let _ = logging::info(&format!(
            "AUDIT {outcome} caller={caller} action={action} reason={reason} seq={seq}"
        ));
        Ok(out)
    }

    pub fn get_audit(_input: &[u8]) -> Result<Vec<u8>, String> {
        let tid_bytes = tenant_context::tenant_did();
        let tid = hex::encode(&tid_bytes);
        let policy_map = format!("z:{tid}:policy");

        // AUTHORIZE: only the tenant owner (caller == tenant) or a DID listed
        // in policy `auditors` may read the audit trail.
        let authorized = match tenant_context::calling_user_did() {
            Some(c) => {
                c == tid_bytes || {
                    let cd = format!("did:t3n:{}", hex::encode(&c));
                    kv_get_string(&policy_map, b"auditors")?
                        .unwrap_or_default()
                        .split(',')
                        .map(|s| s.trim())
                        .any(|s| s == cd)
                }
            }
            None => false,
        };
        if !authorized {
            return serde_json::to_vec(&json!({
                "error": "not_authorized",
                "hint": "audit is restricted to the tenant owner or designated auditors"
            }))
            .map_err(|e| e.to_string());
        }

        let trail_map = format!("z:{tid}:trail");
        let rows = kv_store::scan(&trail_map, &[0u8], &[0xffu8], 500)
            .map_err(|e| format!("audit scan: {e}"))?;
        // Sort ascending by key so the exported chain is in seq order regardless
        // of scan ordering.
        let mut rows = rows;
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        let events: Vec<Value> = rows
            .into_iter()
            .filter_map(|(_k, v)| serde_json::from_slice::<Value>(&v).ok())
            .collect();

        // Export the PUBLIC salt so the chain is offline-verifiable.
        serde_json::to_vec(&json!({ "salt": chain_salt(&tid), "events": events }))
            .map_err(|e| e.to_string())
    }

    pub fn reset(_input: &[u8]) -> Result<Vec<u8>, String> {
        let tid_bytes = tenant_context::tenant_did();
        let tid = hex::encode(&tid_bytes);
        // owner-only
        let is_owner = matches!(tenant_context::calling_user_did(), Some(c) if c == tid_bytes);
        if !is_owner {
            return Err("reset: owner only".to_string());
        }
        let map = format!("z:{tid}:trail");
        let rows = kv_store::scan(&map, &[0u8], &[0xffu8], 1000)
            .map_err(|e| format!("scan {map}: {e}"))?;
        let mut cleared = 0u32;
        for (k, _v) in rows {
            kv_store::delete(&map, &k).map_err(|e| format!("delete {map}: {e}"))?;
            cleared += 1;
        }
        serde_json::to_vec(&json!({ "reset": true, "cleared": cleared }))
            .map_err(|e| e.to_string())
    }

    /// Read-only: return the calling tenant's chain head (current tail `hash`),
    /// or the genesis 64-zeros when the trail is empty. Appends NO row.
    pub fn head(_input: &[u8]) -> Result<Vec<u8>, String> {
        let tid = tid_hex();
        let trail_map = format!("z:{tid}:trail");
        let head = tail_prev_hash(&trail_map)?;
        serde_json::to_vec(&json!({
            "head": head,
            "tenant_did": format!("did:t3n:{tid}"),
        }))
        .map_err(|e| e.to_string())
    }

    /// Owner-or-approved: cross-anchor a PEER tenant's head into THIS tenant's
    /// own trail. Appends a NORMAL chained row (same audit_write/hash path) with
    /// action = {"type":"seal","peer_did":...,"peer_head":...} and outcome
    /// "allowed". The gate matches record_action's grant model OR tenant owner.
    pub fn seal_peer(input: &[u8]) -> Result<Vec<u8>, String> {
        let tid_bytes = tenant_context::tenant_did();
        let tid = hex::encode(&tid_bytes);
        let salt = chain_salt(&tid);
        let policy_map = format!("z:{tid}:policy");
        let trail_map = format!("z:{tid}:trail");

        let caller = caller_did();

        // Owner-or-approved gate: tenant owner always passes; otherwise the
        // caller must hold an active grant (same model as record_action).
        let is_owner =
            matches!(tenant_context::calling_user_did(), Some(c) if c == tid_bytes);
        if !is_owner {
            let grant_key = format!("grant:{caller}");
            let grant = kv_get_string(&policy_map, grant_key.as_bytes())?.unwrap_or_default();
            if grant != "active" {
                return Err("seal_peer: owner or active grant required".to_string());
            }
        }

        let req: Value =
            serde_json::from_slice(input).map_err(|e| format!("bad request json: {e}"))?;
        let peer_did = req
            .get("peer_did")
            .and_then(|v| v.as_str())
            .ok_or("seal_peer: missing peer_did")?;
        let peer_head = req
            .get("peer_head")
            .and_then(|v| v.as_str())
            .ok_or("seal_peer: missing peer_head")?;

        // action is the canonical JSON of the seal descriptor, stored as the
        // row's `action` string so it round-trips and the verifier can parse it.
        let action_val = json!({
            "type": "seal",
            "peer_did": peer_did,
            "peer_head": peer_head,
        });
        let action = chain::canonical_json(&action_val);

        let ts = tenant_context::cluster_timestamp_secs();
        let seq = tenant_context::seq_no();

        let out = write_chained_row(
            &trail_map,
            &salt,
            seq,
            ts,
            &caller,
            &action,
            "allowed",
            "",
            "",
        )?;
        let _ = logging::info(&format!(
            "SEAL caller={caller} peer_did={peer_did} peer_head={peer_head} seq={seq}"
        ));
        Ok(out)
    }

    /// Owner-only: revoke a caller's grant. Sets policy `grant:<target_did>` =
    /// "revoked" so the next `record_action` from that DID is DENIED (and the
    /// denial is chained as a receipt). Owner-gate matches reset()/get_audit().
    pub fn revoke(input: &[u8]) -> Result<Vec<u8>, String> {
        let tid_bytes = tenant_context::tenant_did();
        let tid = hex::encode(&tid_bytes);
        // owner-only
        let is_owner = matches!(tenant_context::calling_user_did(), Some(c) if c == tid_bytes);
        if !is_owner {
            return Err("revoke: owner only".to_string());
        }
        let req: Value =
            serde_json::from_slice(input).map_err(|e| format!("bad request json: {e}"))?;
        let target = req
            .get("target_did")
            .and_then(|v| v.as_str())
            .ok_or("revoke: missing target_did")?;

        let policy_map = format!("z:{tid}:policy");
        let key = format!("grant:{target}");
        kv_store::put(&policy_map, key.as_bytes(), b"revoked")
            .map_err(|e| format!("revoke put: {e}"))?;
        let _ = logging::info(&format!("REVOKE target={target}"));
        serde_json::to_vec(&json!({ "revoked": target })).map_err(|e| e.to_string())
    }
}

#[cfg(target_arch = "wasm32")]
impl exports::z::on_the_record::contracts::Guest for Component {
    fn record_action(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("record_action: missing input")?;
        imp::record_action(&input)
    }

    fn get_audit(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.unwrap_or_default();
        imp::get_audit(&input)
    }

    fn reset(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.unwrap_or_default();
        imp::reset(&input)
    }

    fn revoke(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("revoke: missing input")?;
        imp::revoke(&input)
    }

    fn head(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.unwrap_or_default();
        imp::head(&input)
    }

    fn seal_peer(
        req: exports::z::on_the_record::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("seal_peer: missing input")?;
        imp::seal_peer(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

// ----------------------------------------------------------------------------
// Native (non-wasm) tests for the PURE chain helper.
// ----------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::chain::{canonical_json, chain_hash, GENESIS_PREV_HASH};
    use serde_json::json;

    const SALT: &str = "on-the-record:v1:test-tenant";

    /// Build a row's hash exactly like the contract does: hash the record
    /// WITHOUT its `hash` field, against the given prev_hash.
    fn row_hash(prev_hash: &str, seq: u64, action: &str, outcome: &str) -> String {
        let record = json!({
            "seq": seq,
            "ts": 1700u64,
            "caller_did": "did:t3n:abcd",
            "action": action,
            "outcome": outcome,
            "masked_secret": "",
            "reason": if outcome == "allowed" { "" } else { "no_active_grant" },
            "prev_hash": prev_hash,
        });
        chain_hash(SALT, prev_hash, &record)
    }

    #[test]
    fn genesis_uses_64_zeros() {
        assert_eq!(GENESIS_PREV_HASH.len(), 64);
        assert!(GENESIS_PREV_HASH.chars().all(|c| c == '0'));
        // genesis row chains off the all-zeros prev_hash.
        let h0 = row_hash(GENESIS_PREV_HASH, 0, "init", "allowed");
        assert_eq!(h0.len(), 64, "sha256 hex is 64 chars");
        assert!(h0.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn successive_rows_chain() {
        // Row 0 (genesis).
        let h0 = row_hash(GENESIS_PREV_HASH, 0, "init", "allowed");
        // Row 1's prev_hash MUST equal row 0's hash (the chain link).
        let h1 = row_hash(&h0, 1, "next", "allowed");
        assert_ne!(h0, h1);

        // Tamper detection: any field change changes the row hash...
        let h0_tampered = row_hash(GENESIS_PREV_HASH, 0, "tampered", "denied");
        assert_ne!(h0, h0_tampered, "any field change must change the row hash");
        // ...and re-deriving row 1 against the tampered tail yields a different
        // hash, so prev_hash binds row N+1 to row N.
        let h1_from_tamper = row_hash(&h0_tampered, 1, "next", "allowed");
        assert_ne!(h1, h1_from_tamper, "prev_hash binds row N+1 to row N");
    }

    #[test]
    fn canonical_json_sorts_keys_deterministically() {
        let a = json!({ "b": 2, "a": 1, "c": 3 });
        let b = json!({ "c": 3, "a": 1, "b": 2 });
        // Same content, different insertion order -> identical canonical form.
        assert_eq!(canonical_json(&a), canonical_json(&b));
        assert_eq!(canonical_json(&a), "{\"a\":1,\"b\":2,\"c\":3}");
    }

    #[test]
    fn seal_row_chains_and_carries_peer_head() {
        // A seal row is just another chained row: its `action` is the canonical
        // JSON of {"type":"seal","peer_did":...,"peer_head":...}. It must chain
        // off the prior head AND its peer_head must be recoverable by parsing
        // the action string (this is exactly what the cross-anchor verifier does).
        let peer_head = "ab".repeat(32); // a plausible 64-hex peer head
        let action_val = json!({
            "type": "seal",
            "peer_did": "did:t3n:beef",
            "peer_head": peer_head,
        });
        let action = canonical_json(&action_val);

        let h0 = row_hash(GENESIS_PREV_HASH, 0, "init", "allowed");
        let seal_hash = row_hash(&h0, 1, &action, "allowed");
        assert_eq!(seal_hash.len(), 64);
        assert!(seal_hash.chars().all(|c| c.is_ascii_hexdigit()));

        // Recover peer_head from the action string (verifier's path).
        let parsed: serde_json::Value = serde_json::from_str(&action).unwrap();
        assert_eq!(parsed["type"], "seal");
        assert_eq!(parsed["peer_head"], peer_head);

        // Tampering with the embedded peer_head changes the row hash.
        let tampered_action = canonical_json(&json!({
            "type": "seal",
            "peer_did": "did:t3n:beef",
            "peer_head": "cd".repeat(32),
        }));
        let tampered_hash = row_hash(&h0, 1, &tampered_action, "allowed");
        assert_ne!(seal_hash, tampered_hash, "forged peer_head must change the hash");
    }

    #[test]
    fn hash_is_salt_dependent() {
        let record = json!({ "seq": 0u64, "prev_hash": GENESIS_PREV_HASH });
        let h_a = chain_hash("salt-A", GENESIS_PREV_HASH, &record);
        let h_b = chain_hash("salt-B", GENESIS_PREV_HASH, &record);
        assert_ne!(h_a, h_b, "domain-separation salt must change the hash");
    }
}
