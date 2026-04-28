# Changelog

All notable changes to the OC Agent Protocol specification.

## [Unreleased] — federation principal (DRAFT)

Additive extension. Introduces a `principal.alg = "federation"` opt-in case so a delegation can be authentic only when M-of-N declared guardians have BIP-322-signed the canonical message. Single-address delegations (the v1 / v1.1 / v1.2 case) are unchanged. The proposal lives at [`FEDERATION.md`](./FEDERATION.md).

This entry is **draft** — open for review on the `spec/federation-v1.2` branch. Not yet normative. Scheduled to land alongside the federation-aware verifier path in `@orangecheck/agent-core`, the federation-signing helpers in `@orangecheck/agent-signer`, and the federation `/signin` flow on `console.ochk.io`.

### Proposed additions (when normative)

- **`FEDERATION.md`** — normative companion document. Defines the federation descriptor (content-addressed guardian set + threshold), the canonical-message substitution (`principal: federation:<descriptor_id>` replaces the single-address `principal: <btc_address>` line), the new `sig.alg = "federation-bip322"` with a `signatures[]` array, verification rules, revocation rules, guardian rotation semantics, action-envelope posture (agent still signs alone), and at least 8 conformance vectors.
- **One new field-rule case** (added to `SPEC.md` §4.4): `principal.alg` MAY equal `"federation"` for v1.2 federation principals, in which case `principal.descriptor_id` and `principal.descriptor` are required and `sig.alg` MUST equal `"federation-bip322"`.
- **One new envelope-shape case** for revocation envelopes (analogous to delegation).
- **No existing test-vector verdicts change** under federation extension. v1 / v1.1 / v1.2-private-scope vectors remain byte-identical and pass under any v1.2-federation verifier.

### Backward compatibility

A v1 / v1.1 verifier seeing a federation-principal envelope already rejects it under §4.4 (`principal.alg` MUST equal `"bip322"` in v1). The federation case is therefore safely publishable on existing relays — older verifiers fail closed. A v1.2-federation verifier MUST handle both single-address and federation principals.

## [1.2.0] — 2026-04 — private-scope

Additive extension. No v1.0 / v1.1 envelope, scope, or signature format changes. Introduces an optional confidential mode for the delegation `scopes` field, an OC Lock dependency, four new error codes, and a verifier extension. v1.0 verifiers fail closed on private-mode envelopes (correct); v1.2 verifiers handle both modes.

### Added

- **`PRIVATE-SCOPE.md`** — normative companion document. Defines the optional `scopes_encrypted` field as a wholesale OC Lock v2 `LockEnvelope` (`kind: "identity"`) wrapping a canonical JSON array of scope strings as its payload. Mutual exclusion with the v1.0 `scopes` field — exactly one MUST be present. Verifier algorithm extension (`SPEC.md` §8.1 PRE-VERIFICATION steps P1–P6: mutual exclusion, presence, issuer binding, inner-sig verify, decryption capability check, decrypt then proceed). Composition rules with v1.1 sub-delegation chains (each link MAY independently use private mode; mixed chains are valid). Three new threat-model entries (T17 relay-observable scope leakage RESOLVED, T18 recipient-identity leakage ACKNOWLEDGED, T19 forward-secrecy on key compromise, T20 cross-mode replay). Implementer's checklist and worked example.
- **Four new error codes** (added to `SPEC.md` §11):
  - `E_SCOPES_BOTH_PROVIDED` — envelope carries both `scopes` and `scopes_encrypted`.
  - `E_SCOPES_NEITHER_PROVIDED` — envelope carries neither.
  - `E_SCOPES_UNREADABLE` — verifier holds no key matching any recipient.
  - `E_BAD_LOCK_ENVELOPE` — the inner OC Lock envelope failed its own verification.
- **Test vectors v15–v17** in `test-vectors/`:
  - `v15-private-scope-minimal.json` (positive): single-recipient sealed-scope delegation.
  - `v16-private-scope-multi-recipient.json` (positive): two recipients (agent + verifier).
  - `v17-private-scope-no-key-fails-closed.json` (negative): verifier without a recipient key returns `E_SCOPES_UNREADABLE`.

### Changed

- **`SPEC.md` §3** — envelope-family table notes the v1.2 confidential mode for delegations.
- **`SPEC.md` §11** — error table gains the four v1.2 codes.
- **`SPEC.md` §17** — privacy-preserving scope removed from "Future work" (now shipped); recipient-identity-confidential delegations added as a successor deferred item.

### Backwards compatibility

A v1.0 / v1.1 verifier seeing a v1.2 private-mode envelope sees `scopes` is missing, fails `E_MALFORMED`. Correct fail-closed behavior — verifiers that don't understand scope encryption MUST NOT accept the delegation. A v1.2 verifier seeing a v1.0 / v1.1 public-mode envelope skips PRE-VERIFICATION and runs the standard algorithm with byte-identical results. **No existing test vector v01–v14 changes verdict under v1.2.**

### Cryptographic dependency

Private-mode envelopes embed an OC Lock v2 `LockEnvelope` ([`oc-lock-protocol`](https://github.com/orangecheck/oc-lock-protocol) SPEC.md §4). OC Lock's `seal()` / `unseal()` provide X25519 KEM + AES-GCM AEAD + HKDF-SHA256 key derivation; a v1.2 implementation MUST consume these primitives unchanged. The reference SDK's `@orangecheck/agent-core` 0.3.0 declares `@orangecheck/lock-core` as a peer dependency.

## [1.1.0] — 2026-04 — sub-delegation

Additive extension. No v1.0 envelope, scope, or signature format changes. Introduces a new envelope kind, a new Nostr kind, four new error codes, and a chain-walking verifier procedure.

### Added

- **`SUB-DELEGATION.md`** — normative companion document. Defines the `agent-subdelegation` envelope (`v: 1`, `kind: "agent-subdelegation"`), Nostr kind **30086** (claimed exclusively by this spec), `d`-tag prefix `oc-agent-sub:`, file extension `.subdelegation`, MIME `application/vnd.oc-agent.subdelegation+json`. Specifies the chain-walking verifier algorithm with strict scope/temporal containment per link, default depth cap of 5 (`E_SUBDELEGATION_DEPTH_EXCEEDED`), revocation propagation by per-link lookup, three new security threats (T14 scope escalation, T15 chain-depth DoS, T16 cascade-revocation laundering), implementer's checklist, and a worked treasurer→finance-bot→vendor-bot example.
- **Four new error codes** (added to `SPEC.md` §11): `E_SUBDELEGATION_DEPTH_EXCEEDED`, `E_SUBDELEGATION_PRINCIPAL_MISMATCH`, `E_SUBDELEGATION_EXPIRES_EXTENDED`, `E_SUBDELEGATION_SCOPE_ESCALATED`. v1.0 codes apply uniformly to chain links where the failing check is identical at the per-envelope level.
- **`LIFECYCLE.md` §1.4** — sub-delegation lifecycle entry with cascade-by-parent-revocation semantics and the "no bond on a sub-delegation" stance.
- **Test vectors v10–v14** in `test-vectors/`:
  - `v10-subdelegation-minimal.json` (positive): minimal sub off v01.
  - `v11-subdelegation-chain-depth-3.json` (positive): depth-3 chain v01 → v10 → v11.
  - `v12-subdelegation-scope-escalated.json` (negative): scope expansion → `E_SUBDELEGATION_SCOPE_ESCALATED`.
  - `v13-subdelegation-expires-extended.json` (negative): window extends beyond parent → `E_SUBDELEGATION_EXPIRES_EXTENDED`.
  - `v14-subdelegation-principal-mismatch.json` (negative): wrong sub-principal → `E_SUBDELEGATION_PRINCIPAL_MISMATCH`.

### Changed

- **`SPEC.md` §3** — envelope-family table gains a `Sub-delegation (v1.1)` row; kind-registry note adds the kind-30086 claim.
- **`SPEC.md` §16** — IANA section lists kind 30086, `.subdelegation`, and the v1.1 MIME type.
- **`SPEC.md` §17** — sub-delegation removed from "Future work" (now shipped); bond layering on sub-delegations added as a successor deferred item.
- **`LIFECYCLE.md` §1** — corrected stale prose: kind 30083 is co-claimed (was: described as exclusive to OC Agent), kind 30084 is exclusive to OC Agent (was: described as "shared transport with OC Stamp"); action `d`-tag corrected from `oc-stamp:` to `oc-agent-act:`. These were inherited bugs from before the F1 SPEC corrections.

### Backwards compatibility

A v1.0 verifier encountering:
- A subdelegation envelope on Nostr kind 30086: ignored entirely (v1.0 verifiers don't subscribe to 30086).
- An action citing a subdelegation: `delegation_id` resolves only to a kind-30086 event; v1.0 verifier looks up at kind 30083, finds nothing, fails `E_DELEGATION_MISMATCH`. Correct fail-closed behavior.

A v1.1 verifier handling v1.0 envelopes: chain length 1 (`[D_root]`); step 3 of the algorithm has zero iterations; step 4 runs as a v1.0 action verification. Identical verdict to v1.0 verifiers. **No existing test vector v01–v09 changes verdict under the v1.1 algorithm.**

## [Unreleased] — 2026-04

### Added

- **`LIFECYCLE.md`** — normative companion document specifying per-kind lifecycles for delegation (30083), action (30084), and revocation (30085). Clarifies that actions are themselves non-revocable (only future actions on a delegation are denied by kind-30085, never past ones — priority via OTS anchor per `SPEC.md` §9.3); that revocations are themselves non-revocable (re-grant by publishing a new delegation); and that bond withdrawal works via UTXO spend with re-resolution at action-evaluation time per `SPEC.md` §8 / `E_BOND_UNVERIFIED`. Reaffirms that dashboard-local hide flags and NIP-09 deletion-request events have no protocol force. No protocol changes; clarification only.

### Changed

- **`SPEC.md` §3, §10, §16** — kind 30083 is now documented as **co-claimed** with [OC Stamp](https://github.com/orangecheck/oc-stamp-protocol). OC Agent uses `d`-tag prefix `oc-agent-del:`; OC Stamp uses `oc-stamp:`. The two are runtime-unambiguous via disjoint `d`-tag namespaces, distinct `event.tags` shape, and the envelope's internal `kind` field. Verifiers querying kind 30083 alone (no `#d` filter) MUST inspect envelope `kind` after fetching. No wire-format change; clarifies family-level reality. Companion change in `oc-stamp-protocol` mirrors this acknowledgement.
- **`SPEC.md` §7.3** — added an `Example scope string` column to the registered MVP scopes table, illustrating realistic constraint-list syntax for each of the 8 registered verbs (`lock:seal`, `lock:chat`, `stamp:sign`, `vote:cast`, `nostr:publish`, `http:request`, `ln:send`, `mcp:invoke`). No grammar change; readers no longer need to mentally fuse §7.3 + §7.6 to picture a real scope.

- **`SPEC.md` §3, §10.3, §16 — kind 30084 prose corrected.** Earlier wording said kind 30084 was "shared with OC Stamp for action transport." That was inaccurate: OC Stamp v1 publishes stamps on kind 30083, not 30084. Agent-actions reuse OC Stamp's envelope **structure** (canonical message, BIP-322 sig, OTS anchor field) on a distinct Nostr kind (30084) that is exclusive to this spec. No wire-format change; on-the-wire behavior of every existing implementation was already aligned with this corrected description. Verifier disambiguation simplifies — a `kinds: [30084]` filter alone suffices for agent-actions.

- **`test-vectors/`** — added 4 negative vectors and the negative-vector schema. The original 5 vectors all asserted canonical-message round-trip (positive path); the new vectors assert specific verifier rejections per §8.1 / §11:
  - `v06-action-scope-denied.json` — action exercises a recipient not granted by v01 → `E_SCOPE_DENIED` (§8.1 step 12, §7.4).
  - `v07-action-out-of-window.json` — action signed after v01's `expires_at` → `E_OUT_OF_WINDOW` (§8.1 step 11).
  - `v08-revocation-unauthorized-signer.json` — revocation of v01 signed by the agent address (not in `revocation.holders`) → `E_REVOKER_UNAUTHORIZED` (§9.2, §8.1 step 7).
  - `v09-delegation-malformed-scope.json` — delegation with a scope string missing its operator (`recipient bc1q…` instead of `recipient=bc1q…`) → `E_BAD_SCOPE_GRAMMAR` (§7.1, §8.1 step 4); plus 5 additional malformed-scope examples for implementer smoke-test coverage (no verb, empty parens, empty value, case violation, ordered-op with non-integer).
  - `test-vectors/README.md` documents the negative-vector schema (`"negative": true`, `expected.error_code`, `expected.spec_reference`, `harness_assertion`) so new vectors of either flavor can be added consistently.

## [1.0.0] — 2026-04

Initial release of the OC Agent Protocol specification.

### Added

- Delegation envelope (`kind: "agent-delegation"`, Nostr kind 30083) — principal-signed grant of scoped authority to an agent address, bounded by expiry and optional OrangeCheck-referenced bond.
- Agent-action envelope (`kind: "agent-action"`, Nostr kind 30084 shared with OC Stamp) — agent-signed exercise of a delegation. Strict extension of [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol) with `delegation_id` and `scope_exercised` fields.
- Revocation envelope (`kind: "agent-revocation"`, Nostr kind 30085) — principal- or agent-signed termination of a delegation, OTS-anchorable for priority ordering.
- Scope grammar (§SPEC 7) — compact declarative `<product>:<verb>(<constraint-list>)` strings with a deterministic sub-scope relation. MVP registry of 8 scopes: `lock:seal`, `lock:chat`, `stamp:sign`, `vote:cast`, `nostr:publish`, `http:request`, `ln:send`, `mcp:invoke`.
- Full verification algorithm (§SPEC 8) — offline, pure-function of envelopes + Nostr + Bitcoin headers. No ochk.io endpoint required at verify time.
- Security model and threat analysis (`SECURITY.md`), covering 13 in-scope threats (T1–T13) and the implementation requirements for compliant libraries.
- Error code registry (§SPEC 11) with 17 codes.
- Test-vectors directory scaffold for cross-implementation conformance.

### Notes

- OC Agent composes with every sibling in the OrangeCheck stack: OrangeCheck attestations supply the bond; OC Lock can wrap sensitive delegations and action payloads; OC Stamp's canonical-message discipline underlies the agent-action envelope; OC Vote provides a registered `vote:cast` scope.
- Anchoring is optional but strongly recommended for any high-stakes delegation — priority ordering against revocations requires OTS.
- Nostr kind 30084 carries OC Agent actions, which reuse OC Stamp's envelope structure but live on a distinct Nostr kind (stamps go on 30083). Kind 30083 (delegation) is co-claimed with OC Stamp under disjoint `d`-tag prefixes (see Unreleased note); kind 30085 (revocation) is claimed exclusively by this spec.
