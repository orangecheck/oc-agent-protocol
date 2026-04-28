# Sub-delegation (OC Agent v1.1)

> **Normative companion to [`SPEC.md`](./SPEC.md).** This document specifies the `agent-subdelegation` envelope and the chain-walking verifier extension that together let an agent grant a *narrower* slice of its delegated authority to another agent. The extension is **additive** to v1.0: no envelope, scope, or signature format defined in `SPEC.md` changes. A v1.0 verifier that has not been upgraded sees only an unfamiliar Nostr kind and a `delegation_id` it cannot resolve, fails closed with `E_DELEGATION_MISMATCH`, and is correct in doing so.

## 0. The stance

A subdelegation is a delegation **whose principal is itself an agent of an upstream delegation**. The agent of the upstream delegation is acting as the principal of a new, narrower delegation it issues to a sub-agent. The chain of authority is: *root principal* → *agent₁ (sub-principal)* → *agent₂ (sub-sub-principal)* → … → *leaf agent*. The leaf agent signs `agent-action` envelopes that cite the leaf subdelegation; verifiers walk the chain back to a root delegation rooted in a Bitcoin-address principal.

Sub-delegations are **strictly narrowing**:

- **Scope.** Every scope in a sub-delegation MUST be a sub-scope (per `SPEC.md` §7.4) of *some* scope granted by its immediate parent.
- **Time.** A sub-delegation's `[issued_at, expires_at)` MUST be contained within its parent's `[issued_at, expires_at)`.
- **Identity.** A sub-delegation's `principal.address` MUST equal its parent's `agent.address` — only the addressee of a delegation may sub-delegate from it.

A sub-delegation MAY NOT carry its own bond. The economic stake on a chain is the bond on the root delegation; sub-agents inherit the principal's reputational commitment but cannot stake further sats themselves. This is a deliberate v1.1 simplification — bond layering may be revisited in a later version.

## 1. Sub-delegation envelope

A **sub-delegation** is a single canonical JSON object referred to by file extension `.subdelegation` and MIME type `application/vnd.oc-agent.subdelegation+json`.

### 1.1 Canonical message (sub-principal-signed)

The sub-principal's BIP-322 signature commits to this exact byte sequence:

```
oc-agent:subdelegation:v1
parent_id: <64-hex>
principal: <btc_address>
agent: <btc_address>
scopes: <scope_1> || "," || <scope_2> || "," || …
issued_at: <ISO 8601 UTC>
expires_at: <ISO 8601 UTC>
nonce: <32-hex>
```

Each line is terminated by a single LF (`0x0a`). There is no trailing LF after the `nonce` line. The first line is the literal 25-byte string `oc-agent:subdelegation:v1` — a domain separator that prevents cross-envelope signature replay against the v1.0 delegation preamble.

`parent_id` is the canonical id of the immediate parent envelope, which MAY be either a v1.0 `agent-delegation` (root) or another `agent-subdelegation` (deeper chain).

Scopes are serialized in **sorted order** (lexicographic byte order) and joined by a single ASCII comma. Scope grammar is `SPEC.md` §7.

### 1.2 Envelope id

```
id := H(canonical_message_bytes)
```

`id` is 32 bytes, serialized as 64 lowercase hex characters. It is the BIP-322 signing target.

### 1.3 Envelope schema

```json
{
    "v": 1,
    "kind": "agent-subdelegation",
    "id": "<64-hex>",
    "parent_id": "<64-hex>",

    "principal": {
        "address": "<btc_address; equals parent.agent.address>",
        "alg": "bip322"
    },

    "agent": {
        "address": "<btc_address>",
        "alg": "bip322"
    },

    "scopes": ["<scope strings, each a sub-scope of some parent scope>"],

    "issued_at": "2026-04-23T12:00:00Z",
    "expires_at": "2026-04-29T12:00:00Z",
    "nonce": "<32-hex random>",

    "revocation": {
        "holders": ["principal"] | ["principal", "agent"],
        "ref": "nostr:30085:oc-agent-rev:<id>" | null
    },

    "sig": {
        "alg": "bip322",
        "pubkey": "<principal.address>",
        "value": "<base64 BIP-322 signature>"
    }
}
```

Note the absence of a `bond` field. Sub-delegations MUST NOT carry one. A v1.1 verifier seeing a `bond` field on a sub-delegation MUST treat the envelope as malformed (`E_MALFORMED`).

### 1.4 Field rules

| Field | Rule |
|---|---|
| `v` | Integer. Current version is `1`. Verifiers MUST reject unknown versions. |
| `kind` | MUST equal `"agent-subdelegation"`. |
| `id` | MUST equal `H(canonical_message)` as hex. |
| `parent_id` | 64-hex. MUST equal the immediate parent envelope's `id`. |
| `principal.address` | MUST match `principal` in the canonical message AND MUST equal the immediate parent's `agent.address`. |
| `agent.address` | MUST match `agent` in the canonical message. MAY equal `principal.address` only if the sub-principal is delegating to itself for narrower-scope purposes (rare; permitted). |
| `scopes` | Non-empty array. Each MUST be valid per `SPEC.md` §7 AND MUST be a sub-scope (per `SPEC.md` §7.4) of some scope in the immediate parent's `scopes`. |
| `issued_at`, `expires_at` | MUST match the canonical message. `expires_at > issued_at`. **`issued_at` MUST be ≥ parent's `issued_at`. `expires_at` MUST be ≤ parent's `expires_at`.** |
| `nonce` | 32 hex chars, uniformly random. |
| `revocation.holders` | Same semantics as `SPEC.md` §4.4: who MAY publish a kind-30085 revocation targeting this subdelegation. Default `["principal"]`. |
| `sig.alg` | MUST equal `"bip322"` in v1. |
| `sig.pubkey` | MUST equal `principal.address`. |
| `sig.value` | MUST verify under BIP-322 as a signature by `principal.address` over the hex-encoded `id` (64 ASCII bytes). |

### 1.5 Signing

The sub-principal signs the lowercase-hex ASCII `id` (64 bytes) using BIP-322 under their Bitcoin address — identical to `SPEC.md` §4.5 for delegations.

## 2. Chain-walking verification

A **chain** is an ordered list `C = [D_root, S_1, S_2, …, S_leaf]` where:

- `D_root` is a v1.0 `agent-delegation` envelope (kind 30083).
- Each `S_i` is a v1.1 `agent-subdelegation` envelope (kind 30086).
- `|C| - 1` is the **chain depth** (a chain with only `D_root` has depth 0; the most common subchain `[D_root, S_1]` has depth 1).
- An action `A` is verified against the chain when it cites `S_leaf.id` (or `D_root.id` if depth is 0).

### 2.1 Depth limit

Conforming verifiers MUST reject chains exceeding their configured maximum depth with `E_SUBDELEGATION_DEPTH_EXCEEDED`. The default cap is **5**. Verifiers MAY configure lower caps to constrain attack surface; they MUST NOT silently accept chains beyond their advertised cap.

### 2.2 Algorithm

Given an action `A` and a chain `C`:

```
verifyAction_with_chain(A, C, revocations_by_id):

  1. Depth: |C|-1 <= MAX_DEPTH else E_SUBDELEGATION_DEPTH_EXCEEDED.

  2. Verify D_root per SPEC §8.1 steps 1–6 (skip step 7 — revocation
     is checked uniformly for all chain links in step 5 below).

  3. For i = 1, 2, …, leaf:
     3a. Verify S_i envelope shape and id (canonical reconstruction)
         per §1.4. Else E_MALFORMED / E_BAD_ID.
     3b. Verify S_i scopes parse + validate per SPEC §7. Else
         E_BAD_SCOPE_GRAMMAR.
     3c. Verify S_i.sig under BIP-322 by S_i.principal.address over
         hex(S_i.id). Else E_BAD_SIG.
     3d. Temporal: S_i.issued_at <= now < S_i.expires_at. Else
         E_NOT_YET_VALID / E_EXPIRED.
     3e. Linkage: S_i.parent_id == parent.id where parent = C[i-1].
         AND  S_i.principal.address == parent.agent.address.
         Else E_SUBDELEGATION_PRINCIPAL_MISMATCH.
     3f. Temporal containment:
            S_i.issued_at  >= parent.issued_at
         AND S_i.expires_at <= parent.expires_at.
         Else E_SUBDELEGATION_EXPIRES_EXTENDED.
     3g. Scope containment: ∀ scope ∈ S_i.scopes,
         ∃ parent_scope ∈ parent.scopes such that
         isSubScope(scope, parent_scope) per SPEC §7.4.
         Else E_SUBDELEGATION_SCOPE_ESCALATED.

  4. Verify the action A against the leaf:
     leaf := C[|C|-1]
     4a. A.delegation_id == leaf.id. Else E_DELEGATION_MISMATCH.
     4b. A.signer.address == leaf.agent.address. Else E_AGENT_MISMATCH.
     4c. A.signed_at ∈ [leaf.issued_at, leaf.expires_at). Else E_OUT_OF_WINDOW.
     4d. A.scope_exercised is a sub-scope of some scope in leaf.scopes
         (per SPEC §7.4). Else E_SCOPE_DENIED.
     4e. Run SPEC §8.2 base-stamp checks on A. Else E_BAD_ACTION_STAMP.

  5. Revocation check (per-link, applied to action's effective time):
     For each envelope E in C (root + every subdelegation):
       If revocations_by_id[E.id] contains a valid revocation r whose
       effective time (per SPEC §9.3) precedes A.signed_at,
       return E_REVOKED.

  6. Optional bond check (caller policy):
     6a. D_root.bond non-null else E_NO_BOND.
     6b. D_root.bond.sats >= caller.threshold else E_BOND_UNMET.
     6c. resolve(D_root.bond.attestation_id) still valid per
         caller.policy else E_BOND_UNVERIFIED.
     (Sub-delegations cannot carry bonds; the root's bond is the
     economic commitment for the whole chain.)
```

### 2.3 Cross-implementation determinism

Every verifier walking the same chain with the same `now`, the same revocation set, and the same `MAX_DEPTH` MUST produce the same verdict. The order of step 3 sub-checks is fixed; conforming implementations MUST NOT short-circuit on a later check in a way that masks an earlier code (e.g., a step 3g scope-escalation must not be returned when a step 3d temporal violation is also present — the temporal check fires first per the listed order).

## 3. Revocation propagation

A kind-30085 `agent-revocation` envelope MAY target either:

- A root `agent-delegation` envelope (`delegation_id` is a v1.0 delegation id), OR
- A sub-delegation envelope (`delegation_id` is a v1.1 subdelegation id).

The envelope shape is unchanged from `SPEC.md` §9.1. The targeted envelope is resolved by querying both kind 30083 (root delegations) and kind 30086 (sub-delegations) on Nostr.

**Cascade rule.** Revoking any link in a chain invalidates the link AND all of its descendants. A revocation of `D_root` invalidates every chain rooted in `D_root` regardless of any sub-delegation's own `revocation.holders`. Conforming verifiers implement this by performing the per-link revocation check in step 5 above — finding a revocation at any depth fails the action, no special cascade logic required.

**Revocation authority over a subdelegation.** Per the targeted envelope's `revocation.holders`. A subdelegation `S_i` whose `revocation.holders = ["principal"]` may be revoked by `S_i.principal.address` — that is, by the parent's agent (the immediate sub-principal). The ultimate root principal does NOT inherit the right to revoke arbitrary intermediate sub-delegations directly; they revoke the chain by revoking `D_root`.

Sub-agents that need self-defense ("I've been compromised; please don't honor anything I've signed under this grant") set `revocation.holders = ["principal", "agent"]` on their accepted sub-delegation, mirroring `SPEC.md` §9.2.

## 4. Nostr directory

Sub-delegations are published to Nostr **kind 30086** — claimed by this v1.1 extension within the OrangeCheck family's 30078–30099 range.

### 4.1 Sub-delegation event

```
event.kind       = 30086
event.tags       = [
  ["d",            "oc-agent-sub:" || subdelegation_id],
  ["parent",       parent_id],
  ["root",         root_delegation_id],
  ["principal",    principal.address],
  ["agent",        agent.address],
  ["expires",      expires_at_unix_seconds],
  ["scope",        scope_1],
  ["scope",        scope_2], …
]
event.content    = <canonical JSON of subdelegation envelope>
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

The `["root", root_delegation_id]` tag is a discoverability convenience: it lets verifiers resolve the entire chain back to the root in a single query (`#root: <id>`). The `parent` tag lets verifiers walk the chain link-by-link if `root` is missing or untrusted. Both MUST be present on conforming events.

### 4.2 Discovery queries

By immediate parent (find all direct sub-delegations of a delegation):
```
REQ { "kinds": [30086], "#parent": ["<parent_id>"], "limit": 50 }
```

By root (find all sub-delegations rooted in a specific delegation):
```
REQ { "kinds": [30086], "#root": ["<root_delegation_id>"], "limit": 200 }
```

By sub-agent (find all sub-delegations issued to a specific address):
```
REQ { "kinds": [30086], "#agent": ["<bc1q…>"], "limit": 100 }
```

By id (resolve a specific sub-delegation):
```
REQ { "kinds": [30086], "#d": ["oc-agent-sub:<id>"], "limit": 1 }
```

### 4.3 Verifier-side chain assembly

A verifier given an action `A` whose `delegation_id` matches a subdelegation envelope assembles the chain by:

1. Look up `A.delegation_id` at kind 30086. If found, that's `S_leaf`. If not found, look up at kind 30083; if found, the chain is `[D_root]` (depth 0). Else `E_DELEGATION_MISMATCH`.
2. While the current envelope is a subdelegation, fetch its `parent_id` from kind 30086 (or kind 30083 if not found). Prepend to the chain.
3. Stop when the prepended envelope is a kind-30083 root delegation. The chain is complete.
4. Hand the chain to the §2.2 algorithm.

A verifier MAY accept an explicit `chain` argument from the caller and skip the Nostr lookup, useful for offline verification with bundled envelopes.

## 5. Errors (additions to `SPEC.md` §11)

| Code | Meaning |
|---|---|
| `E_SUBDELEGATION_DEPTH_EXCEEDED` | Chain depth exceeds the verifier's configured maximum. |
| `E_SUBDELEGATION_PRINCIPAL_MISMATCH` | A subdelegation's `parent_id` does not match the parent's `id`, or its `principal.address` does not match the parent's `agent.address`. |
| `E_SUBDELEGATION_EXPIRES_EXTENDED` | A subdelegation's `[issued_at, expires_at)` is not contained within its parent's window. |
| `E_SUBDELEGATION_SCOPE_ESCALATED` | A subdelegation grants a scope that is not a sub-scope of any scope in its parent. |

All other v1.0 codes (`E_BAD_ID`, `E_BAD_SIG`, `E_REVOKED`, `E_SCOPE_DENIED`, etc.) apply uniformly to the chain — a verifier returns the v1.0 code when the failing check is identical at the per-envelope level.

## 6. Worked example

A non-profit's treasurer (`bc1qceo…`) issues a 90-day delegation `D_root` granting their finance bot (`bc1qfin…`) permission to send Lightning payments capped at 10000 sats per call:

```json
D_root = {
    "kind": "agent-delegation",
    "id": "ROOT_ID",
    "principal": {"address": "bc1qceo…"},
    "agent":     {"address": "bc1qfin…"},
    "scopes":    ["ln:send(max_sats<=10000, max_fee_sats<=100)"],
    "issued_at": "2026-04-01T00:00:00Z",
    "expires_at": "2026-06-30T00:00:00Z",
    "bond":      {"sats": 1000000, "attestation_id": "…"},
    …
}
```

The finance bot then sub-delegates a narrower right to a single-vendor payment bot (`bc1qvendor…`) for one week, capped at 1000 sats per call to a specific Lightning node:

```json
S_1 = {
    "kind": "agent-subdelegation",
    "id": "SUB1_ID",
    "parent_id": "ROOT_ID",
    "principal": {"address": "bc1qfin…"},          // = D_root.agent.address
    "agent":     {"address": "bc1qvendor…"},
    "scopes":    ["ln:send(max_sats<=1000, max_fee_sats<=10, node=03abc…)"],
    "issued_at": "2026-04-22T00:00:00Z",            // >= D_root.issued_at
    "expires_at": "2026-04-29T00:00:00Z",           // <= D_root.expires_at
    …
}
```

The vendor bot signs an `agent-action` invoking the actual payment:

```json
A = {
    "kind": "agent-action",
    "delegation_id": "SUB1_ID",
    "scope_exercised": "ln:send(max_sats=850, max_fee_sats=8, node=03abc…)",
    "signer": {"address": "bc1qvendor…"},
    "signed_at": "2026-04-23T14:32:00Z",
    …
}
```

A verifier walks `[D_root, S_1]`, confirms `S_1.principal.address == D_root.agent.address`, `S_1.scopes ⊆ D_root.scopes`, `S_1`'s window is contained within `D_root`'s, then verifies `A` against `S_1`. Pass.

If the treasurer later revokes `D_root` (kind-30085 with `delegation_id: "ROOT_ID"`) and the revocation's OTS anchor predates a new vendor-bot action, the new action fails `E_REVOKED` regardless of `S_1`'s independent state.

## 7. Security additions (to `SPEC.md` §12)

### T14. Scope escalation in a subdelegation

A compromised sub-principal might issue a subdelegation granting more than they were granted (e.g., `max_sats<=10000` when their parent grants `max_sats<=1000`). The chain-walking verifier catches this at step 3g (`E_SUBDELEGATION_SCOPE_ESCALATED`). Exhibiting the attack requires forging the sub-principal's BIP-322 signature, which is the `SPEC.md` T1 threat — caught at step 3c (`E_BAD_SIG`).

### T15. Chain-depth DoS

A malicious actor publishes deep chains (1000+ sub-delegations) intending to make verification expensive. Mitigation: `MAX_DEPTH` cap (default 5; step 1). Verifiers SHOULD reject chains exceeding the cap *before* fetching beyond the cap from Nostr.

### T16. Cascade-revocation laundering

A sub-principal who realizes their sub-agent is exfiltrating sats might try to "un-revoke" by re-issuing a fresh subdelegation with an OTS anchor predating the revocation. Mitigation: sub-delegation revocation comparison uses the revocation's OTS anchor (per `SPEC.md` §9.3); a revocation issued at time `t_r` cannot be circumvented by a subdelegation whose claimed `issued_at` is earlier without the subdelegation also being OTS-anchored to a comparable block. Without an OTS anchor, the subdelegation's `issued_at` is unproven and the revocation wins.

## 8. Backwards compatibility

A v1.0 verifier (one that does not implement this document) encountering:

- **A subdelegation envelope** on Nostr kind 30086: ignored entirely. v1.0 verifiers do not subscribe to kind 30086 because `SPEC.md` does not mention it.
- **An action citing a subdelegation** (`A.delegation_id` resolves only to a kind-30086 event, not kind-30083): the v1.0 verifier looks up `delegation_id` at kind 30083, finds nothing, fails with `E_DELEGATION_MISMATCH` (or its equivalent). This is correct: an action whose authority chain the verifier cannot evaluate MUST fail closed.

A v1.1 verifier handling a v1.0 envelope (no chain): the chain `C = [D_root]` (depth 0); step 3 has zero iterations; step 4 runs as a v1.0 action verification. Identical verdict to v1.0 verifiers.

No existing test vector (v01–v09 in `test-vectors/`) changes verdict under the v1.1 algorithm. Test vectors v10–v14 cover the new chain cases.

## 9. Implementer's checklist (additions to `SPEC.md` §14)

- [ ] Recognizes `kind: "agent-subdelegation"` envelopes, computes id from canonical message, verifies BIP-322.
- [ ] Subscribes to Nostr kind 30086 with the correct `d`-tag prefix when fetching chains.
- [ ] Walks chains step-by-step per §2.2, in the listed order, returning the documented error code on each branch.
- [ ] Enforces a configurable `MAX_DEPTH` (default 5) and rejects deeper chains with `E_SUBDELEGATION_DEPTH_EXCEEDED`.
- [ ] Performs revocation lookup against EVERY link in the chain, not just the leaf or the root.
- [ ] Refuses to construct subdelegation envelopes carrying a `bond` field.
- [ ] Passes test vectors v10 (positive minimal chain), v11 (positive depth-3 chain), v12 (negative scope-escalation), v13 (negative expires-extension), v14 (negative principal-mismatch).
- [ ] When operating offline (caller-supplied chain), verifies the chain exactly as for the Nostr-fetched case — no relaxation.

## 10. IANA / external identifiers (additions to `SPEC.md` §16)

- Nostr event kind: **30086** (subdelegation, addressable, claimed exclusively by this spec).
- File extension: `.subdelegation`.
- MIME type: `application/vnd.oc-agent.subdelegation+json` (self-allocated; not IANA-registered).
- `d`-tag prefix: `oc-agent-sub:`.

---

End of v1.1 sub-delegation extension.
