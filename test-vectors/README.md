# OC Agent test vectors

Fixed inputs, fixed intermediate byte strings, fixed outputs. Any conforming OC Agent v1 implementation MUST produce byte-identical canonical messages and envelope ids for these vectors. If you're implementing OC Agent in a new language, these are the ground truth.

## Structure

Each `.json` file in this directory is an independent vector. The schema varies by envelope kind (delegation, action, revocation) but every vector includes:

```json
{
  "description": "what this vector exercises",
  "kind": "delegation" | "action" | "revocation",
  "inputs": { ... kind-specific ... },
  "expected": {
    "canonical_message": "<exact LF-terminated bytes as a JSON string>",
    "canonical_message_bytes_len": <integer>,
    "id": "<64-hex SHA-256 of canonical message>",
    "envelope": { ... fully-formed envelope with ids and placeholder signature ... }
  },
  "signature_check": {
    "address_type": "p2pkh" | "p2sh_p2wpkh" | "p2wpkh" | "p2tr",
    "format": "bip137" | "bip322-simple",
    "signed_message": "<the hex id, the string the wallet signed>",
    "expected": { "outcome": "ACCEPT" } | { "outcome": "REJECT", "error_code": "<the §11 code>" }
  }
}
```

`signature_check` is present only in v67–v76, whose envelopes carry real signatures.

See `SPEC.md` §4.1, §5.1, §9.1 for the canonical-message shape of each envelope kind.

## Conformance

Given the `inputs`, a compliant implementation MUST:

1. Build the canonical message byte-identical to `expected.canonical_message` (each line LF-terminated, no trailing LF after the final line, no BOM).
2. Compute `id = sha256(canonical_message_bytes)` and match `expected.id`.
3. Serialize the envelope with RFC 8785 JSON canonicalization, matching `expected.envelope` when re-parsed.
4. Return `id` as lowercase hex.
5. For a vector with `signature_check`, verify `expected.envelope` with the real BIP-322 verifier: a delegation alone (SPEC §8.1 step 5), an action with the delegation its `cross_refs.delegation_vector` names (§8.2 step 8). `ACCEPT` means it verifies, `REJECT` means verification fails with `error_code`.

If any of these diverge, the implementation is non-conformant.

Typical bugs:

- Trailing LF after the final line of the canonical message (the spec says no trailing LF).
- CRLF line endings instead of LF.
- Capitalizing the hex `id`, `delegation_id`, or `content_hash`.
- Missing the domain-separator preamble (`oc-agent:delegation:v1`, `oc-agent:action:v1`, or `oc-agent:revocation:v1`).
- Failing to sort `scopes` lexicographically before joining with commas in the canonical message.
- Failing to sort constraints by key within a scope string before canonicalization.
- Lowercasing constraint values. §7.2 keeps every value exactly as written (since 1.6.2); hex, MIME types, bech32 addresses and a URL's scheme and host are refused unless already lower case (1.10.0).
- Emitting numeric fields (like `content_length`, `bond.sats`) as strings in the envelope JSON.

## A note on signatures

- In v01–v66, `sig.value` is a placeholder (e.g. `"AAAA"`), not a signature. Those vectors test the canonical message, the id and the envelope; a verifier that runs them needs its signature check stubbed or skipped.
- v67–v76 carry real signatures from disclosed burn keys (see "Signature vectors" below). Two wallets signing the same id need not produce the same bytes: an ECDSA wallet may not use RFC 6979 nonces, and a BIP-340 (P2TR) signature takes fresh auxiliary randomness. The assertion is that a signature **verifies**, never that it equals a stored one.

## Test harness

The `@orangecheck/agent-core` suite in `oc-packages/agent-core/` loads this directory and asserts, per vector:

1. `expected.canonical_message` is reconstructed byte-identical from `inputs`.
2. `expected.id === sha256(canonical_message)`.
3. Envelope fields re-serialize to the declared RFC 8785 canonical form.
4. Sub-scope relation computations (where vectors provide exercised/granted pairs) return the declared accept/reject.
5. Each vector with `signature_check` verifies, or is refused with its `error_code`, through the real `@orangecheck/bip322` verifier, and the set covers all four address types plus a refused signature.

New implementations should add a similar test.

## Current vectors

### Positive (canonical-message + id round-trip)

| File | Kind | Exercises |
|---|---|---|
| `v01-delegation-minimal.json` | delegation | Single scope, no bond — canonical-message baseline |
| `v02-delegation-with-bond.json` | delegation | Multi-scope (sorted), with OrangeCheck-bond reference, ordered/constrained scope values |
| `v03-action-minimal.json` | action | Agent-action citing v01 delegation with exact-match scope |
| `v04-revocation-minimal.json` | revocation | Empty-reason principal-signed revocation of v01 |
| `v05-revocation-with-reason.json` | revocation | Principal-signed revocation of v02 with non-empty `reason` |
| `v28-delegation-window-365-days.json` | delegation | Window of exactly 365 days, the §4.4 limit (inclusive) — MUST verify |
| `v29-delegation-values-keep-case.json` | delegation | Upper-case values (MCP tool name, URL path, base58 address) kept as written by §7.2; constraints given out of order are sorted by key |
| `v33-revocation-by-agent.json` | revocation | Agent-signed revocation of v01, whose `revocation.holders` is `["principal"]` — the agent may always revoke (§9.5), MUST verify |
| `v34-revocation-reason-not-ascii.json` | revocation | Revocation of v02 whose reason is outside ASCII — a signer MUST NOT write it, but it MUST verify and v02 is revoked (§9.1) |
| `v35-revocation-reason-control-characters.json` | revocation | Revocation of v02 whose reason holds a tab and a line break — MUST verify, v02 revoked (§9.1) |
| `v36-revocation-reason-300-bytes.json` | revocation | Revocation of v02 whose reason is 300 bytes — MUST verify, v02 revoked (§9.1) |
| `v37-revocation-no-sig-pubkey.json` | revocation | Revocation of v02 whose copy has no `sig.pubkey` — MUST verify, v02 revoked (§9.1) |
| `v38-revocation-v-as-text.json` | revocation | Revocation of v02 whose copy has `v` as the text `"1"` — MUST verify, v02 revoked (§9.1) |
| `v39-federation-revocation-extra-bad-entries.json` | revocation | v25 with a bad, an unknown and a repeated guardian entry beside its 3 valid signatures — MUST verify, v19 revoked (FEDERATION.md §4); `harness.bip322` says which value fails |
| `v40-revocation-reason-null.json` | revocation | Revocation of v02 whose copy writes the reason as `null`, read as `""` — MUST verify, v02 revoked (§9.1) |
| `v41-revocation-stated-id-differs.json` | revocation | Revocation of v02 whose copy states an id that is not the id of its signed fields — MUST verify against the computed id, flagged `id_mismatch`, v02 revoked (§9.1) |
| `v42-revocation-kind-other.json` | revocation | Revocation of v02 whose copy carries `kind: "revocation"` — MUST verify, flagged `kind_nonconforming`, v02 revoked (§9.1) |
| `v43-delegation-not-equal-grants.json` | delegation | Grants written with `!=`: `nostr:publish(kind!=0)` and `http:request(method!=POST,…)` |
| `v44-action-kind-one-under-not-zero.json` | action | `kind=1` under v43's `kind!=0` — MUST verify (§7.4) |
| `v48-delegation-unregistered-key-permissive.json` | delegation | A grant with an unregistered key (`region=eu`), read in permissive mode (`inputs.scope_mode`) — MUST verify; a strict verifier returns `expected.strict_outcome`, `E_BAD_SCOPE_GRAMMAR` (§7.6) |
| `v53-action-base58-keeps-case.json` | action | A base58 recipient in its own case under v29 — not a fault (§7.2 rule 4), MUST verify |
| `v55-action-url-path-keeps-case.json` | action | A server URL with a lower-case host and a `/Tools` path under v29 — a path keeps its case (§7.2 rule 4), MUST verify |
| `v58-delegation-hash-prefix.json` | delegation | `stamp:sign(content_hash_prefix=ab)` — = on a prefix key means "starts with" (§7.2 rule 5) |
| `v59-action-hash-prefix-longer.json` | action | `content_hash_prefix=abc` under v58, over content whose hash starts with `abc` — MUST verify |
| `v62-delegation-stamp-content-bounds.json` | delegation | `stamp:sign(content_hash_prefix=ab,max_bytes<=10,mime=text/plain)` — three content-bound keys (§8.3 step 12a) |
| `v63-action-stamp-content-within.json` | action | text/plain, 5 bytes, hash `ab…` under v62 — MUST verify |

### Negative (verifier MUST reject with the declared `expected.error_code`)

Negative vectors carry the marker `"negative": true` at the top level. They assert a specific verification rejection per `SPEC.md` §8.1 / §11 (or `SUB-DELEGATION.md` §2.2 / §5 for v1.1 cases). Most do not assert a canonical-message round-trip. v27 does: its id is honest, so the window is the only fault.

A live vector (`"live": true`, v30–v32) is checked by live verification (SPEC §8) at `inputs.verified_at`, with the freshness bound `inputs.max_skew_seconds` and the revocations in `inputs.revocations`, each given as the inputs of a revocation of the cited delegation. Every other action vector is an audit (§8.6), checked as of its own `signed_at`. A vector with `inputs.scope_mode` is read in that §7.6 mode; every other vector is read in strict mode.

| File | Kind | Expected error | Spec reference |
|---|---|---|---|
| `v06-action-scope-denied.json` | action | `E_SCOPE_DENIED` | §8.1 step 12, §7.4 |
| `v07-action-out-of-window.json` | action | `E_OUT_OF_WINDOW` | §8.1 step 11 |
| `v08-revocation-unauthorized-signer.json` | revocation | `E_REVOKER_UNAUTHORIZED` | §9.5, §8.1 step 7 |
| `v09-delegation-malformed-scope.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.1, §8.1 step 4 |
| `v27-delegation-window-366-days.json` | delegation | `E_MALFORMED` | §4.4, §8.1 step 2 |
| `v30-action-live-revocation-in-effect.json` | action, live | `E_REVOKED` | §8.1 step 7, §9.3 |
| `v31-action-live-delegation-expired.json` | action, live | `E_EXPIRED` | §8.1 step 6 |
| `v32-action-live-stale.json` | action, live | `E_STALE` | §8.3 step 11a |
| `v45-action-kind-zero-written-00.json` | action | `E_SCOPE_DENIED` | §7.2 rule 4, §7.4 (`00` is the integer 0) |
| `v46-action-method-lower-case.json` | action | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`method=post`) |
| `v47-delegation-kind-not-a-number.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`kind=abc`; the envelope is honest, so the value is the only fault) |
| `v49-action-unregistered-key-unmet.json` | action, permissive | `E_SCOPE_DENIED` | §7.4, §7.6 (v48's `region=eu` still binds) |
| `v50-delegation-hex-upper-case.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`node` in upper-case hex) |
| `v51-delegation-mime-mixed-case.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`mime=Text/Markdown`) |
| `v52-delegation-bech32-upper-case.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`recipient=BC1Q…`) |
| `v54-delegation-url-host-upper-case.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`origin=https://API.example.com`) |
| `v56-delegation-mime-parameters.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (`mime="text/html;charset=utf-8"`) |
| `v57-delegation-hash-prefix-not-equal.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 5 (`!=` on a prefix key) |
| `v61-action-hash-prefix-other.json` | action | `E_SCOPE_DENIED` | §7.4 (`content_hash_prefix=ac` under v58's `=ab`) |
| `v64-action-stamp-content-oversize.json` | action | `E_SCOPE_DENIED` | §8.3 step 12a (content 999999 bytes under `max_bytes<=10`) |
| `v65-action-stamp-content-wrong-mime.json` | action | `E_SCOPE_DENIED` | §8.3 step 12a (text/html content under `mime=text/plain`) |
| `v66-action-stamp-content-hash-outside.json` | action | `E_SCOPE_DENIED` | §8.3 step 12a (hash `99…` under `content_hash_prefix=ab`) |
| `v60-delegation-method-not-ascii.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.2 rule 4 (a method with U+0420 for P) |
| `v12-subdelegation-scope-escalated.json` | subdelegation | `E_SUBDELEGATION_SCOPE_ESCALATED` | SUB-DELEGATION.md §2.2 step 3g |
| `v13-subdelegation-expires-extended.json` | subdelegation | `E_SUBDELEGATION_EXPIRES_EXTENDED` | SUB-DELEGATION.md §2.2 step 3f |
| `v14-subdelegation-principal-mismatch.json` | subdelegation | `E_SUBDELEGATION_PRINCIPAL_MISMATCH` | SUB-DELEGATION.md §2.2 step 3e |

### Signature vectors (v67–v76)

These carry real signatures from four **disclosed burn keys**. The private keys are published in `generate-signatures.mjs` and must never hold funds: anyone can spend what is sent to their addresses. They are the keys `oc-stamp-protocol`'s v10–v14 and `oc-vote-protocol`'s v19–v23 use; #1 and #2 are `oc-attest-protocol`'s tv21 and tv22 keys.

Each delegation is v01's (the same scope, window and nonce) with one key's address as both principal and agent. Each action is v03's (the same content, `signed_at` and scope) under that delegation, signed by the same address as agent. The wallet signs the hex id (SPEC §4.5), so `signature_check.signed_message` equals `expected.id`. Their windows have passed, so a live check refuses them as expired: run them as an audit (§8.6), or with the time inside the window.

| File | Kind | Exercises |
|---|---|---|
| `v67-sig-p2pkh-delegation.json` | delegation | v01 signed by a P2PKH address, legacy BIP-137 form: MUST verify |
| `v68-sig-p2pkh-action.json` | action | v03 under v67, the same key and form: MUST verify |
| `v69-sig-p2sh-p2wpkh-delegation.json` | delegation | The same, P2SH-P2WPKH, BIP-322 simple form: MUST verify |
| `v70-sig-p2sh-p2wpkh-action.json` | action | v03 under v69: MUST verify |
| `v71-sig-p2wpkh-delegation.json` | delegation | The same, P2WPKH, BIP-322 simple form: MUST verify |
| `v72-sig-p2wpkh-action.json` | action | v03 under v71: MUST verify |
| `v73-sig-p2tr-delegation.json` | delegation | The same, P2TR key path, BIP-322 simple form: MUST verify |
| `v74-sig-p2tr-action.json` | action | v03 under v73: MUST verify |
| `v75-sig-action-tampered.json` | action | v72 with one signature byte flipped: its delegation v71 verifies, the action MUST NOT (`E_BAD_ACTION_STAMP`, §8.2 step 8) |
| `v76-sig-delegation-tampered.json` | delegation | v71 with one signature byte flipped: MUST NOT verify (`E_BAD_SIG`, §8.1 step 5) |

| Key | Private key (hex) | Address type | Address | Vectors |
|---|---|---|---|---|
| #1 | `01` repeated 32 times | P2WPKH | `bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw` | v71, v72, v75, v76 |
| #2 | `02` repeated 32 times | P2TR, key path (BIP-86) | `bc1p5e6v9v2j5wp3y6c79gaqdqltq7jdv45fswnnm7exmmp2020mqepsmcx06p` | v73, v74 |
| #3 | `03` repeated 32 times | P2PKH | `16yH2E12NYA5pg1d4BB7wtXXnBTZ8Lws7L` | v67, v68 |
| #4 | `04` repeated 32 times | P2SH-P2WPKH | `38Sqvnn4PbsHHfarwki7bm2vSeYvuZDgpz` | v69, v70 |

`node test-vectors/generate-signatures.mjs` writes v67–v76 again. It loads bip322-js 3, bitcoinjs-lib 6, ecpair 2 and @bitcoinerlab/secp256k1 from `oc-packages/wallet-adapter/node_modules` in a clone next to this repository, or from the directory in `OC_SIGNER_NODE_MODULES`, and writes nothing unless its canonical-message builders reproduce v01 and v03. v67–v72, v75 and v76 come out byte for byte the same; v73's and v74's P2TR signatures differ on each run and still verify.

### Sub-delegation positive (v1.1)

| File | Kind | Exercises |
|---|---|---|
| `v10-subdelegation-minimal.json` | subdelegation | Minimal sub off v01 — agent-of-v01 sub-delegates to a sub-agent with same scope, narrower window. Canonical-message + id round-trip for the new envelope kind. |
| `v11-subdelegation-chain-depth-3.json` | subdelegation | Depth-3 chain: v01 → v10 (S1) → this (S2). Exercises chain-walking: principal-equals-parent-agent and window containment at every link. |

### Private-scope (v1.2)

Vectors with `"private_scope": true` exercise the v1.2 confidentiality extension. Inputs include the recipient's X25519 keypair (public + secret hex) so the harness can decrypt deterministically. The OC Lock envelope itself uses fresh random nonces and ephemeral keypairs at seal time, so byte-identical reproducibility of the ciphertext is NOT asserted — what's pinned is the ROUND-TRIP outcome (decrypted scopes equal `expected.decrypted_scopes`; verifier verdict matches `expected.verification_outcome`).

| File | Kind | Exercises | Expected |
|---|---|---|---|
| `v15-private-scope-minimal.json` | delegation | Single-recipient seal + verify round-trip. | ACCEPT |
| `v16-private-scope-multi-recipient.json` | delegation | Two recipients (agent + auditor); both decrypt independently. | ACCEPT |
| `v17-private-scope-no-key-fails-closed.json` | delegation | Verifier holds an unrelated keypair, NOT a recipient. | REJECT (`E_SCOPES_UNREADABLE`) |

### Federation (v1.2)

Vectors `v18`–`v26` exercise [`FEDERATION.md`](../FEDERATION.md): a federation (M-of-N guardians) as the principal.

| File | Kind | Exercises | Expected |
|---|---|---|---|
| `v18-federation-descriptor-3of5.json` | federation-descriptor | Descriptor canonical message + id baseline: 3-of-5, five guardians, lex-sorted. | — |
| `v19-federation-delegation-3of5-valid.json` | delegation | Federation-principal delegation, 3-of-5 threshold met. | ACCEPT |
| `v20-federation-delegation-2of5-below-threshold.json` | delegation | Only 2 of 5 guardian signatures. | REJECT (`E_FEDERATION_BELOW_THRESHOLD`) |
| `v21-federation-delegation-duplicate-guardian.json` | delegation | Three signatures under one guardian address. | REJECT (`E_FEDERATION_DUPLICATE_GUARDIAN`) |
| `v22-federation-delegation-unknown-guardian.json` | delegation | One signature under an address outside the guardian set. | REJECT (`E_FEDERATION_UNKNOWN_GUARDIAN`) |
| `v23-federation-delegation-descriptor-id-mismatch.json` | delegation | `descriptor_id` is not the hash of the descriptor. | REJECT (`E_FEDERATION_DESCRIPTOR_MISMATCH`) |
| `v24-federation-delegation-threshold-mismatch.json` | delegation | `sig.threshold` differs from the descriptor's threshold. | REJECT (`E_FEDERATION_THRESHOLD_MISMATCH`) |
| `v25-federation-revocation-3of5-valid.json` | revocation | Federation-principal revocation, 3-of-5 threshold met. | ACCEPT |
| `v26-federation-singleaddress-baseline-unchanged.json` | delegation | A single-address (v1) delegation under a v1.2-federation verifier verifies byte-identically. | ACCEPT |

### Negative-vector schema

```json
{
  "description": "what makes this case invalid",
  "kind": "delegation" | "action" | "revocation",
  "negative": true,
  "inputs": { ... kind-specific; structurally well-formed except for the violated rule ... },
  "expected": {
    "verification_outcome": "REJECT",
    "error_code": "E_<one of §11>",
    "spec_reference": "§N.M step K",
    "rejection_reason": "human-readable explanation pointing at the specific rule"
  },
  "cross_refs": { ... vectors this one depends on (e.g., the cited delegation) ... },
  "harness_assertion": "what a conformant implementation MUST do"
}
```

Cross-vector relationships (enforced by the test harness):

- `v03.inputs.delegation_id === v01.expected.id`
- `v04.inputs.delegation_id === v01.expected.id`
- `v05.inputs.delegation_id === v02.expected.id`
- `v06.inputs.delegation_id === v01.expected.id` (action against v01 with out-of-scope recipient)
- `v07.inputs.delegation_id === v01.expected.id` (action against v01 outside its lifetime)
- `v08.inputs.delegation_id === v01.expected.id` (revocation by a third party)
- `v33.inputs.delegation_id === v01.expected.id` (revocation by v01's agent)
- `v34`–`v38`, `v40`–`v42`: `inputs.delegation_id === v02.expected.id`, and `expected.delegation_outcome` is what v02 verifies to with the revocation passed in (`E_REVOKED`)
- `v40`–`v42`: `expected.id` is computed from `inputs`; `expected.flags` lists where the envelope's copies differ from it (in v41, `expected.envelope.id` is not `expected.id`)
- `v39.inputs.delegation_id === v19.expected.id` (`delegation_outcome`: `E_REVOKED`)
- `v09` is self-contained (the malformed scope is its own input)
- `v27` and `v28` are self-contained (v01's inputs with a 366-day and a 365-day window)
- `v29` is self-contained
- `v10.inputs.parent_id === v01.expected.id` (subdelegation off v01)
- `v11.inputs.parent_id === v10.expected.id` (subdelegation off v10, transitively rooted in v01)
- `v12.inputs.parent_id === v01.expected.id` (scope-escalation negative)
- `v13.inputs.parent_id === v01.expected.id` (expires-extension negative)
- `v14.inputs.parent_id === v01.expected.id` (principal-mismatch negative)
- `v68`, `v70`, `v72`, `v74`, `v75`: `inputs.delegation_id` is the `expected.id` of the delegation `cross_refs.delegation_vector` names (v67, v69, v71, v73, v71)
