# Changelog

All notable changes to the OC Agent Protocol specification.

## [1.5.0] — 2026-10-20 — directory: actions and sub-delegations findable by delegation id

Additive. **No envelope, canonical-message, id or signature change. Verdicts on
every existing test vector are unchanged.** The new tags are on the Nostr
event that carries an envelope, outside the canonical message and the
envelope id, so no artifact changes. 1.4.1 removed the action and
sub-delegation queries that relays reject and left no relay query that could
list either. This release adds the indexed tags those listings need.

### Added

- **§10.3 action event.** Publishers SHOULD add `["t", delegation_id]`. Query
  `REQ { "kinds": [30084], "#t": ["<delegation id>"] }` lists the tagged
  actions under a delegation. Keep only events whose `content.delegation_id`
  is the id asked for.
- **`SUB-DELEGATION.md` §4.1 sub-delegation event.** Publishers SHOULD add
  `["t", parent_id]` and `["t", root_delegation_id]`, one tag when the two are
  equal. §4.2 gives the query by parent or root id and the checks for each
  match. The envelope does not carry the root id, so a match by root is
  confirmed by assembling its chain.
- **§10.2.** Actions, revocations and sub-delegations all carry the delegation
  id they cite as a `t` tag in one form: 64 lowercase hex characters, no
  prefix, as revocations have since 1.2.1. One filter on kinds 30084–30086
  finds all three.
- **§10.4.** A relay that answered with no events has no event carrying the
  tag. Where the tag is SHOULD, that does not show the artifact is absent.

### Changed

- **§10.1.** The two `t` tags on a delegation event are a MUST. This states
  what publishers already emit. §10.1 also says outright that tags are outside
  the canonical message and id.
- **§10.1 co-claim note.** No longer recommends `#d`-prefix queries. Tag
  filters match whole values, so a prefix matches nothing. Stamp events tag
  `t` with `oc-stamp`, not `addr` and `hash`.
- **`SUB-DELEGATION.md` §4.2.** The by-id query drops `"limit": 1`. Any key can
  publish under any `d` value, so take the event whose envelope id matches and
  verifies, not the newest one. The §9 checklist fetches links by full `d`
  value, not by prefix.

### Evidence

Measured 2026-10-20, REQ only. On `relay.ochk.io`, `nos.lol` and
`relay.primal.net`, `#t` with a 64-hex delegation id on kind 30084, on kind
30086 and on kinds 30084–30086 together got `EOSE` from all three. `#t`
returned the indexed kind-30086 events those relays hold. Tag filters matched
whole values only: `#d` with a full value returned the event, and `#d` with
its prefix returned nothing on all three. A read of kinds 30083–30086 from
five relays found no event with an `oc-agent-` `d`-tag (`relay.damus.io`
refused the connection), so no published event is known to lack the new
tags.

### Migration

**None required.** Events without the new tags remain valid and are found by
id. No family publisher of kind 30084 or 30086 is active; publishers SHOULD
add the tags when they publish either kind.

## [1.4.1] — 2026-10-20 — errata: discovery queries that relays reject

**Errata release. No envelope, scope, or signature format changes — verdicts on
every existing test vector are unchanged.** The 1.2.1 errata fixed the
revocation query in §9.4. The same mistake remained in every other discovery
query the spec prescribed: each filtered on a multi-letter tag name, which
relays do not index.

### Fixes

- **§10.1 delegation event.** Lists the two `t` tags (principal address, agent
  address) as normative. §3 has directed verifiers to query `#t` since 1.2.1,
  and the reference publisher has emitted both since 2026-04-28; §10.1 did not
  list them.
- **§10.2 delegation discovery.** `"#principal"` and `"#agent"` replaced by
  `"#t"`, with the content checks that a shared `t` namespace needs (the other
  party's address, and OC Stamp envelopes on the co-claimed kind).
- **§10.3 action discovery.** `"#delegation"` removed. Actions are found by id
  (`#d`). There is no conforming query for every action under a delegation:
  the event carries the delegation id only in a multi-letter tag, and adding
  an indexed one would change the event format.
- **§10.4 (new) reading relay replies.** Filters use `#d` and `#t` only. A
  relay has answered only when it sent `EOSE` and every event it returned
  matches the filter. A `CLOSED`, an error `NOTICE`, a dropped connection, a
  timeout or an off-filter event means "not heard back", never "absent". A
  verifier concludes "not revoked" only from relays that answered; if none
  did, revocation is unchecked.
- **§8.1 step 7, §9.4, §14.** Point at §10.4.
- **`SUB-DELEGATION.md` §4.** `"#parent"`, `"#root"` and `"#agent"` removed.
  Sub-delegations are found by id (`#d`), and §4.3 chain assembly says so. §3
  gives the one-query revocation lookup for a whole chain.
- **`PRIVATE-SCOPE.md` §9.** No longer calls the multi-letter tags indexable.
- **`SECURITY.md` §3.1 T7 and §5 item 7.** The revocation query is `#t`, not
  `#delegation`. "Found no revocation" counts only relays that answered.

### Evidence

Measured 2026-10-20, REQ only. `relay.ochk.io`, `nos.lol`, `relay.primal.net`
and `relay.damus.io` each rejected every filter removed above: three with
`CLOSED … unindexed tag filter`, `relay.ochk.io` with a `NOTICE` and no
`EOSE`. A REQ carrying a `#t` filter alongside an `#agent` filter was
rejected whole. `relay.snort.social` ignored `#agent` and returned 50
unrelated kind-30083 events. Every replacement filter got `EOSE` on all four
relays, and `#t` and `#d` returned matching events on kind 30085 from relays
holding them.

### Migration

**None required.** The same sweep found no kind 30083–30086 event carrying an
`oc-agent-` `d`-tag on any of the four relays, so nothing was published in a
shape these fixes would miss.

Reference implementation: `@orangecheck/agent-core` 2.5.1 (error text names
the `#t` query).

## [1.4.0] — 2026-10-19 — registry: the four agent-stack adapter scopes

Additive. No envelope, canonical-message or signature change.

- **§7.3 / §7.6.** Registered the scopes the published adapters exercise:
  `anthropic:tool` and `openai:function` with key `name`, and `vercel:tool`
  and `langgraph:tool` with key `verb`. Strict verifiers previously rejected
  every envelope those adapters produce as an unknown scope, so they verified
  only in permissive mode.
- **§15.** The product list now includes `pledge`, registered in 1.3.0, and
  the four adapter products.

Reference implementation: `@orangecheck/agent-core` 2.5.0.

## [1.3.0] — 2026-09-24 — registry: `pledge:create`

Additive. No envelope, canonical-message or signature change.

- **§7.3 / §7.6.** Registered `pledge:create` with keys `max_bond_sats`
  (integer), `mechanism` and `counterparty`, as defined by oc-pledge-protocol
  SPEC §7.3. Strict verifiers previously rejected it as an unknown scope.

Reference implementation: `@orangecheck/agent-core` 2.3.0.

## [1.2.2] — 2026-09-24 — errata: revocation authority and anchor priority

**Errata release. No envelope, scope, or signature format changes — verdicts on
every existing test vector are unchanged.**

### Fixes

- **§4.4 / §9.5 authorised revokers.** `revocation.holders` is not part of the
  delegation's canonical message, so it can only add the agent. The principal
  is always an authorised revoker.
- **§9.3 effective time.** An OTS anchor counts for priority only after its
  proof is verified to commit the envelope's own `id` at the declared block.
  An unverified anchor is treated as absent. A verified action anchor against
  an unanchored revocation falls back to comparing `signed_at`.
- **FEDERATION.md §4.** A federation revocation is bound to a delegation whose
  principal is the same federation.

Reference implementation: `@orangecheck/agent-core` 2.2.0.

## [1.2.1] — 2026-09-02 — errata: revocation was undiscoverable

**Errata release. No envelope, scope, or signature format changes — verdicts on
every existing test vector are unchanged.** Two statements in `SPEC.md`
described operations that Nostr does not provide, and the reference client
implemented them faithfully, so spec and client were wrong together and agreed
with each other.

### Fixes

- **§9.4 revocation publication + crawl query.** The revocation event carried
  the delegation id only in a multi-letter `delegation` tag, and the spec
  prescribed `REQ { "kinds": [30085], "#delegation": [...] }`. NIP-12 relays
  index **single-letter** tag names only, so that filter matches nothing on a
  conforming relay. A conforming verifier therefore found **no revocations and
  honoured a revoked delegation** — the worst available failure direction.
  The event now normatively carries `["t", delegation_id]` (alongside the
  existing `["t", signer.address]`), and the crawl query is `#t`. Because `t`
  is a shared namespace on these events, a matched event MUST be confirmed
  against `content.delegation_id`.
- **§3.3 kind-30083 disambiguation.** Previously read "Verifiers MUST filter by
  `#d` prefix", which is not an operation NIP-01 defines — tag filters are
  exact-match. Replaced with the implementable rule: query an indexed
  dimension you already know (`#t` address, or `#d` with a full
  `oc-agent-del:<id>`), then discard events whose `content.kind` is not
  `agent-delegation`.

### Migration

**None required.** A relay sweep on 2026-09-02 across `relay.ochk.io`,
`relay.damus.io`, `nos.lol`, `relay.snort.social` and `relay.primal.net` found
zero kind-3008x events carrying an `oc-agent-` `d`-tag prefix, so no published
revocation predates this fix. (The 447 events in that kind range belong to
unrelated applications — a reminder that 30080–30086 are generic NIP-78
addressable kinds, not a reserved allocation, and that the `d`-tag namespace
plus the content-`kind` check are both load-bearing rather than decorative.)

Reference client fix: `oc-agent-web` `lib/nostr/event.ts` +
`lib/nostr/client.ts`, with regression tests that fail against the pre-fix
event shape.

## [1.2.0] — federation principal

Additive extension. Introduces a `principal.alg = "federation"` opt-in case so a delegation can be authentic only when M-of-N declared guardians have BIP-322-signed the canonical message. Single-address delegations (the v1 / v1.1 / v1.2 case) are unchanged. The normative companion is [`FEDERATION.md`](./FEDERATION.md).

Normative. The federation-aware verifier path ships in `@orangecheck/agent-core` (`verifyFederationDelegation` / `verifyFederationRevocation`, conformant against vectors v18–v26). Federation-signing helpers (`@orangecheck/agent-signer`) and the federation `/signin` flow on `fleet.ochk.io` follow per FEDERATION.md §11.

### Additions

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
