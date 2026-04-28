# Changelog

All notable changes to the OC Agent Protocol specification.

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
