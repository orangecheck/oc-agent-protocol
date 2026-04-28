# OC Agent v1.2 — Federation Principal

**Status:** Draft (proposal · not yet normative)
**Date:** 2026-04
**Companion to:** [`SPEC.md`](./SPEC.md), [`SUB-DELEGATION.md`](./SUB-DELEGATION.md), [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md)
**Discussion:** [`oc-agent-protocol#federation`](https://github.com/orangecheck/oc-agent-protocol/issues) (TBD)

---

## 0. Summary

OC Agent v1 binds a delegation's authority to a **single Bitcoin address** as the principal. The principal's BIP-322 signature is what makes the delegation authentic; revocation likewise requires the principal's signature (modulo §9 holder rules).

This proposal adds an **additive** alternative: a **federation principal** — a content-addressed descriptor of a guardian set with an M-of-N threshold. A delegation under a federation principal is authentic iff M of N declared guardians have BIP-322-signed the canonical message; revocation works the same way.

The v1 single-address case is **unchanged**. The federation case is opt-in via `principal.alg = "federation"`. A v1-only verifier MUST reject delegations whose principal is a federation; a v1.2 verifier MUST accept both.

This is the missing primitive for federations (Fedimint guardians, Cashu mints, multi-sig DAOs, federated services) running real autonomous workflows under their collective authority.

---

## 1. Motivation

Federations pool authority. A Fedimint guardian set issues ecash redemption signatures together; no single guardian can mint or burn unilaterally. The same posture should be available for OC Agent delegations: an agent acting in a federation's name should be authorized only by the guardian quorum, not by any single guardian, and should survive any individual guardian going rogue or offline.

Concretely, a federation needs:

- **Issuance**: a delegation envelope authentic only when M-of-N guardians have signed.
- **Revocation**: a revocation envelope authentic only when M-of-N guardians have signed (i.e. a single rogue guardian cannot kill a live delegation).
- **Scope edits**: same threshold for any envelope mutating the agent's authority.
- **Guardian rotation**: changes to the guardian set produce a new principal id; old envelopes remain verifiable against the old set; new envelopes verify against the new set.

The canonical-message format and content-hashing rules for envelopes do not need to change. Only the authentication layer (who signs) and the principal identity layer (what an envelope binds to) need to generalize.

---

## 2. Federation descriptor

A **federation descriptor** is a content-addressed canonical JSON object:

```json
{
  "v": 1,
  "kind": "agent-federation",
  "threshold": "3-of-5",
  "guardians": [
    { "address": "bc1qg1…", "alg": "bip322", "name": "alice"   },
    { "address": "bc1qg2…", "alg": "bip322", "name": "bob"     },
    { "address": "bc1qg3…", "alg": "bip322", "name": "carol"   },
    { "address": "bc1qg4…", "alg": "bip322", "name": "dave"    },
    { "address": "bc1qg5…", "alg": "bip322", "name": "erin"    }
  ]
}
```

Field rules:

| Field | Rule |
|---|---|
| `v` | Integer. Current version is `1`. |
| `kind` | MUST equal `"agent-federation"`. |
| `threshold` | String of the form `"M-of-N"` where M and N are positive decimal integers, `1 ≤ M ≤ N`, and N matches `len(guardians)`. |
| `guardians[i].address` | Bitcoin mainnet address (P2WPKH, P2TR, or P2PKH). |
| `guardians[i].alg` | MUST equal `"bip322"` in v1.2. |
| `guardians[i].name` | Optional human-friendly label. Not part of the canonical id. |
| `guardians` | Non-empty array. **Sorted lexicographically by `address`** for canonical ordering. Duplicate addresses are forbidden. |

### 2.1 Canonical descriptor message

The descriptor is identified by `H(canonical_descriptor_bytes)` where the canonical bytes are derived from this exact line-oriented format:

```
oc-agent:federation:v1
threshold: <M>-of-<N>
guardian: <address_1>
guardian: <address_2>
…
guardian: <address_N>
```

- First line is the literal 23-byte string `oc-agent:federation:v1`.
- `threshold` line: literal "threshold: " (11 bytes including space) + the `<M>-of-<N>` value.
- `guardian` lines: one per guardian, addresses in **lexicographic byte order** (NOT the order in the JSON array — sort before emitting).
- Each line terminated by a single LF (`0x0a`); no trailing LF after the last guardian line.

### 2.2 Descriptor id

```
descriptor_id := H(canonical_descriptor_bytes)
```

Serialized as 64 lowercase hex characters. This id is the federation's stable identity. Adding, removing, or reordering guardians, or changing the threshold, produces a different id (and hence a different principal).

---

## 3. Delegation under a federation principal

### 3.1 Canonical delegation message

When the principal is a federation, the principal-line in the SPEC §4.1 canonical message is replaced as follows:

```
oc-agent:delegation:v1
principal: federation:<descriptor_id>
agent: <btc_address>
scopes: <scope_1> || "," || <scope_2> || "," || …
bond_sats: <non-negative integer, decimal; 0 if unbonded>
bond_attestation: <64-hex OrangeCheck attestation id | "none">
issued_at: <ISO 8601 UTC>
expires_at: <ISO 8601 UTC>
nonce: <32-hex>
```

Only the second line (`principal: …`) differs from the v1 canonical-message format. The literal `federation:` prefix (11 bytes including the colon) before the descriptor id is the additive opt-in flag — single-address delegations still emit `principal: <btc_address>` and verify under v1.

### 3.2 Envelope schema additions

```json
{
  "v": 1,
  "kind": "agent-delegation",
  "id": "<64-hex>",

  "principal": {
    "alg": "federation",
    "descriptor_id": "<64-hex>",
    "descriptor": { /* §2 federation descriptor inline */ }
  },

  "agent":   { "address": "bc1q…", "alg": "bip322" },
  "scopes":  [ … ],
  "bond":    null | { "sats": …, "attestation_id": "…" },
  "issued_at":  "…",
  "expires_at": "…",
  "nonce":   "…",
  "revocation": {
    "holders": ["principal"] | ["principal", "agent"],
    "ref":     "nostr:30085:oc-agent-rev:<id>" | null
  },

  "sig": {
    "alg":         "federation-bip322",
    "threshold":   "3-of-5",
    "signatures": [
      { "guardian_address": "bc1qg1…", "value": "<base64 BIP-322>" },
      { "guardian_address": "bc1qg3…", "value": "<base64 BIP-322>" },
      { "guardian_address": "bc1qg4…", "value": "<base64 BIP-322>" }
    ]
  }
}
```

Field rules (additions over §4.4):

| Field | Rule |
|---|---|
| `principal.alg` | MUST equal `"federation"` for the federation case. |
| `principal.descriptor_id` | MUST equal `H(canonical_descriptor_bytes)` (§2.2). |
| `principal.descriptor` | MUST inline the descriptor JSON object whose canonical hash equals `descriptor_id`. Verifiers re-derive `descriptor_id` from `descriptor` and reject mismatches. |
| `sig.alg` | MUST equal `"federation-bip322"` for the federation case (was `"bip322"`). |
| `sig.threshold` | MUST equal `principal.descriptor.threshold`. |
| `sig.signatures` | Array of guardian signatures. **Length MUST be ≥ M** from `M-of-N`. Each `guardian_address` MUST appear in `principal.descriptor.guardians`. No `guardian_address` may appear twice. Each `value` MUST verify under BIP-322 as a signature by `guardian_address` over the hex-encoded delegation `id` (per §4.5). |

### 3.3 Verification

A v1.2 verifier accepts a federation-principal delegation iff:

1. The single-address path checks all pass (id, scopes, bond, ttl, nonce shape, revocation-holders shape).
2. `principal.alg == "federation"`.
3. `principal.descriptor_id == H(canonical_descriptor_bytes_of(principal.descriptor))`.
4. `sig.threshold == principal.descriptor.threshold`.
5. `len(sig.signatures) ≥ M`.
6. Every `sig.signatures[i].guardian_address` appears in `principal.descriptor.guardians`.
7. No two entries in `sig.signatures` share a `guardian_address`.
8. Every `sig.signatures[i].value` verifies under BIP-322 against the hex-encoded delegation id.

A v1-only verifier MUST reject any delegation whose top-level `principal.alg` is not `"bip322"` (§4.4 already requires this). The federation case is therefore safe to publish on existing Nostr relays — older verifiers will simply ignore it as a v1 violation, which is the correct backward-compat posture.

---

## 4. Revocation under a federation principal

§9's revocation envelope generalizes identically: the canonical message uses the same `principal: federation:<descriptor_id>` substitution; the `sig` block uses `federation-bip322` with M-of-N guardian signatures over the hex-encoded revocation id.

`revocation.holders` keeps the v1 semantics — `["principal"]` means "only the federation can revoke" (i.e. M-of-N guardians signing); `["principal", "agent"]` adds the option of the agent self-revoking via single-address BIP-322 (since the agent identity is still a single address).

---

## 5. Scope edits

OC Agent v1 has no in-place scope-edit envelope; scope changes are modeled as revoking the old delegation and issuing a new one. This proposal preserves that posture: a federation re-issues with M-of-N to widen / narrow scope. `expires_at` stays bounded the same way (≤365 days from `issued_at`).

`SUB-DELEGATION.md` (v1.1) composes naturally — a federation-principal delegation can sub-delegate to another address (or another federation), with the chain-validation rules in v1.1 holding. Each link's signing rules apply to that link's principal: federation links require M-of-N, single-address links require one signature.

---

## 6. Guardian rotation

The descriptor is content-addressed. To rotate guardians:

1. Construct a new descriptor with the updated guardian set.
2. Compute the new `descriptor_id`.
3. Issue a new delegation under the new principal (M-of-N of the **new** guardian set signs).
4. Optionally, the **old** federation issues a revocation (M-of-N of the old set signs) for delegations under the old principal id.

Old envelopes continue to verify against the old descriptor. New envelopes verify against the new descriptor. Verifiers do not need to know about the rotation event itself; the descriptor inlining in each envelope is sufficient.

A future v2 could add an explicit "guardian-set rotation" envelope that links new descriptor id to old, but that is not required for v1.2.

---

## 7. Action envelopes

Action envelopes (kind 30084 per [`SPEC.md`](./SPEC.md) §8) cite `delegation_id` and are signed by the **agent**'s single address — not by the federation. This is intentional: an action is one decision by the agent at one moment, not a federation deliberation. The federation's authority is exercised at issuance / revocation time; the agent acts within that authority autonomously.

If a deployment wants federation-level co-signing on every action, it can either:

- Set the agent address to a Taproot multi-sig descriptor (out-of-band) and have multiple parties co-sign each action's BIP-322 — independent of OC Agent.
- Use [`SUB-DELEGATION.md`](./SUB-DELEGATION.md) to chain a federation-principal delegation to an agent that requires its own quorum. Less efficient; possible.

The default posture (federation issues, agent acts alone) matches Fedimint's separation of guardian authorization from per-transaction signing.

---

## 8. Backward compatibility

- v1 verifiers MUST reject `principal.alg != "bip322"` (already specified in §4.4). Federation-principal delegations are therefore invisible to v1 verifiers — they parse, fail field-rule validation, and are dropped. No silent acceptance of unverified envelopes.
- v1.2 verifiers MUST accept both the v1 single-address case and the new federation case.
- The Nostr publication kind (30083) and d-tag prefix (`oc-agent-del:`) are unchanged.

---

## 9. Test-vector additions (planned)

The v1.2 conformance harness adds at least:

- `delegation_federation_3of5_valid` — well-formed federation-principal delegation, threshold met by 3 of 5 declared guardians.
- `delegation_federation_2of5_invalid` — same shape but only 2 signatures present (below threshold) — verifier MUST reject.
- `delegation_federation_duplicate_guardian` — 3 signatures all under `guardians[0].address` — verifier MUST reject.
- `delegation_federation_unknown_guardian` — signature under an address not in the declared set — verifier MUST reject.
- `delegation_federation_descriptor_id_mismatch` — declared `descriptor_id` does not equal the canonical hash of the inlined descriptor — verifier MUST reject.
- `delegation_federation_threshold_mismatch` — `sig.threshold != principal.descriptor.threshold` — verifier MUST reject.
- `revocation_federation_3of5_valid` — analog for revocation envelopes.
- `delegation_singleaddress_v12_unchanged` — proves the v1 single-address vector remains byte-identical and verifies under a v1.2 verifier.

---

## 10. Open questions

- **Threshold representation.** `"3-of-5"` is human-friendly; `{ "m": 3, "n": 5 }` is structurally cleaner. v1.2 chooses the string form for canonical-message ergonomics (`threshold: 3-of-5` is one short line). Either is workable.
- **Witness signatures.** OC Pledge has the concept of optional witnesses signing a pledge. Should federation delegations support optional non-quorum witnesses (extra guardians who sign for visibility, not for authentication)? Likely yes via an additive `sig.witness_signatures` array in a future revision; out of scope for v1.2.
- **Heterogeneous guardian alg.** v1.2 requires every guardian to use BIP-322. A future revision could allow mixed alg sets (e.g. one guardian signing via FROST taproot multisig). The current proposal is conservative — same-shape signatures everywhere — and a follow-up version can generalize.

---

## 11. Implementation plan

- Spec lands in `oc-agent-protocol` v1.2 alongside `SUB-DELEGATION.md` and `PRIVATE-SCOPE.md`.
- `@orangecheck/agent-core` adds the federation-aware verifier path. Single-address path is unchanged, byte-identical against existing test vectors.
- `@orangecheck/agent-signer` adds `signAsFederation()` (collect M of N BIP-322 signatures and assemble the envelope) plus `addGuardianSignature()` for partial-quorum collection flows.
- `@orangecheck/wallet-adapter` gets a federation-aware sign flow that hands the canonical message to the user's wallet plus the guardian set context.
- `console.ochk.io` adds the federation /signin path (a guardian collection UX) plus a federation-aware `/agents/new`. See [`console.ochk.io/federation`](https://console.ochk.io/federation) for the consumer-side framing.

The implementation can stage:

1. **v1.2.0**: spec + test vectors + verifier path + signer helpers. No console UI yet.
2. **v1.2.1**: console federation UX. Real Fedimint integration via the design-partner cohort.

---

## 12. Charter posture

This proposal is **additive**. It does not change any existing wire-format invariant. v1 envelopes continue to verify identically. Federation-principal envelopes are an opt-in extension that any deployment can ignore.

The protocol stays open. The implementation lives at `@orangecheck/agent-core` (MIT). console.ochk.io is the managed-tier story on top, not the protocol.

No custody is added. The federation primitive does not move funds; it authenticates delegations. Bonded reputation under a federation principal is still attestation-of-unspent — the federation's sats stay where they are.
