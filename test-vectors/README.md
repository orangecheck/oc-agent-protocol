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
  }
}
```

See `SPEC.md` §4.1, §5.1, §9.1 for the canonical-message shape of each envelope kind.

## Conformance

Given the `inputs`, a compliant implementation MUST:

1. Build the canonical message byte-identical to `expected.canonical_message` (each line LF-terminated, no trailing LF after the final line, no BOM).
2. Compute `id = sha256(canonical_message_bytes)` and match `expected.id`.
3. Serialize the envelope with RFC 8785 JSON canonicalization, matching `expected.envelope` when re-parsed.
4. Return `id` as lowercase hex.

If any of these diverge, the implementation is non-conformant.

Typical bugs:

- Trailing LF after the final line of the canonical message (the spec says no trailing LF).
- CRLF line endings instead of LF.
- Capitalizing the hex `id`, `delegation_id`, or `content_hash`.
- Missing the domain-separator preamble (`oc-agent:delegation:v1`, `oc-agent:action:v1`, or `oc-agent:revocation:v1`).
- Failing to sort `scopes` lexicographically before joining with commas in the canonical message.
- Failing to sort constraints by key within a scope string before canonicalization.
- Emitting numeric fields (like `content_length`, `bond.sats`) as strings in the envelope JSON.

## A note on signatures

BIP-322 signatures over ECDSA addresses (P2PKH, P2WPKH) are **non-deterministic** because ECDSA uses random `k`. Vectors cannot specify an exact `sig.value` and expect reproducibility across wallets. The `sig.value` field in each vector's envelope is a placeholder (e.g. `"AAAA"`); the implementation-side assertion is that the signature **verifies**, not that it equals a specific blob.

BIP-322 signatures over Schnorr addresses (P2TR) are deterministic when RFC 6979-style nonce derivation is used, but vendor wallets vary. Treat Schnorr `sig.value` as verify-only.

## Test harness

The `@orangecheck/agent-core` suite in `oc-packages/agent-core/` loads this directory and asserts, per vector:

1. `expected.canonical_message` is reconstructed byte-identical from `inputs`.
2. `expected.id === sha256(canonical_message)`.
3. Envelope fields re-serialize to the declared RFC 8785 canonical form.
4. Sub-scope relation computations (where vectors provide exercised/granted pairs) return the declared accept/reject.

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

### Negative (verifier MUST reject with the declared `expected.error_code`)

Negative vectors carry the marker `"negative": true` at the top level. They do not assert a canonical-message round-trip — instead, they assert a specific verification rejection per `SPEC.md` §8.1 / §11 (or `SUB-DELEGATION.md` §2.2 / §5 for v1.1 cases).

| File | Kind | Expected error | Spec reference |
|---|---|---|---|
| `v06-action-scope-denied.json` | action | `E_SCOPE_DENIED` | §8.1 step 12, §7.4 |
| `v07-action-out-of-window.json` | action | `E_OUT_OF_WINDOW` | §8.1 step 11 |
| `v08-revocation-unauthorized-signer.json` | revocation | `E_REVOKER_UNAUTHORIZED` | §9.2, §8.1 step 7 |
| `v09-delegation-malformed-scope.json` | delegation | `E_BAD_SCOPE_GRAMMAR` | §7.1, §8.1 step 4 |
| `v12-subdelegation-scope-escalated.json` | subdelegation | `E_SUBDELEGATION_SCOPE_ESCALATED` | SUB-DELEGATION.md §2.2 step 3g |
| `v13-subdelegation-expires-extended.json` | subdelegation | `E_SUBDELEGATION_EXPIRES_EXTENDED` | SUB-DELEGATION.md §2.2 step 3f |
| `v14-subdelegation-principal-mismatch.json` | subdelegation | `E_SUBDELEGATION_PRINCIPAL_MISMATCH` | SUB-DELEGATION.md §2.2 step 3e |

### Sub-delegation positive (v1.1)

| File | Kind | Exercises |
|---|---|---|
| `v10-subdelegation-minimal.json` | subdelegation | Minimal sub off v01 — agent-of-v01 sub-delegates to a sub-agent with same scope, narrower window. Canonical-message + id round-trip for the new envelope kind. |
| `v11-subdelegation-chain-depth-3.json` | subdelegation | Depth-3 chain: v01 → v10 (S1) → this (S2). Exercises chain-walking: principal-equals-parent-agent and window containment at every link. |

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
- `v08.inputs.delegation_id === v01.expected.id` (revocation by non-holder)
- `v09` is self-contained (the malformed scope is its own input)
- `v10.inputs.parent_id === v01.expected.id` (subdelegation off v01)
- `v11.inputs.parent_id === v10.expected.id` (subdelegation off v10, transitively rooted in v01)
- `v12.inputs.parent_id === v01.expected.id` (scope-escalation negative)
- `v13.inputs.parent_id === v01.expected.id` (expires-extension negative)
- `v14.inputs.parent_id === v01.expected.id` (principal-mismatch negative)
