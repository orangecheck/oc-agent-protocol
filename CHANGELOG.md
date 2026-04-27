# Changelog

All notable changes to the OC Agent Protocol specification.

## [Unreleased] — 2026-04

### Added

- **`LIFECYCLE.md`** — normative companion document specifying per-kind lifecycles for delegation (30083), action (30084), and revocation (30085). Clarifies that actions are themselves non-revocable (only future actions on a delegation are denied by kind-30085, never past ones — priority via OTS anchor per `SPEC.md` §9.3); that revocations are themselves non-revocable (re-grant by publishing a new delegation); and that bond withdrawal works via UTXO spend with re-resolution at action-evaluation time per `SPEC.md` §8 / `E_BOND_UNVERIFIED`. Reaffirms that dashboard-local hide flags and NIP-09 deletion-request events have no protocol force. No protocol changes; clarification only.

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
- Nostr kind 30084 is shared transport between OC Stamp and OC Agent actions; disambiguation is by envelope `kind`. Kinds 30083 (delegation) and 30085 (revocation) are claimed exclusively by this spec.
