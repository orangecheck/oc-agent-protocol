# Lifecycle of OC Agent envelopes

> **Normative companion to [`SPEC.md`](./SPEC.md) §9 (revocation).** This document specifies what principals and agents MAY do to a delegation, action, or revocation after publication, and what verifiers MUST do in response. It introduces no new envelope kinds, tags, or fields. It pins down the lifecycle stance the spec already establishes and the rest of the OrangeCheck family already shares.

## 0. The family stance

Every OrangeCheck artifact is a **signed envelope**. The signature is the truth; the Nostr event is a directory entry; the bytes already exist on relays and in caches the moment an envelope is published. *Delete* is therefore not a protocol primitive in any verb of the family. The vocabulary the family does define is:

| Verb | What it means |
|---|---|
| **replace** | Publish a new envelope under the same Nostr addressable coordinate. NIP-33 replacement applies. |
| **revoke** | Publish a *separate, signed* envelope that ends the legitimacy of a prior one. Per-verb whether this exists. |
| **withdraw** | Spend the Bitcoin UTXO(s) backing a bond. Visible to verifiers on the next live check. |
| **expire** | Reach `expires_at`. |
| **hide (out-of-protocol)** | A reference dashboard MAY filter the artifact out of its UI. No protocol effect. |
| **request relay deletion (out-of-protocol)** | Publish a NIP-09 kind-5 event. Best-effort; not normative. |

## 1. OC Agent lifecycle, by envelope kind

OC Agent owns four kinds: `30083` (delegation, **co-claimed with OC Stamp** under disjoint `d`-tag prefixes), `30084` (action — claimed exclusively, reuses OC Stamp's envelope **structure** but on a distinct kind), `30085` (revocation), and `30086` _(v1.1)_ (sub-delegation — see [`SUB-DELEGATION.md`](./SUB-DELEGATION.md)). The asymmetry across them is deliberate.

### 1.1 Delegation (kind 30083, `d = oc-agent-del:<delegation_id>`)

- **Replacement.** Delegations are content-addressed by `delegation_id` (SHA-256 of the canonical message), so re-publishing under the same `d` is structurally impossible — any change of a byte produces a different `id` and therefore a different `d`. Delegations are de-facto immutable once published.
- **Revocation (explicit, in-spec).** The principal — and, optionally, the agent if `revocation.holders` permits — terminates a delegation by publishing an `agent-revocation` envelope (kind 30085). This is the *only* spec-defined way to end a delegation early. See §1.3 below for full lifecycle.
- **Expiry.** Delegations carry `delegation.expires_at`. Conforming agents MUST refuse to sign actions where `signed_at > expires_at`; conforming verifiers MUST reject any action whose `D.expires_at` is past at the action's effective time. Expiry is the normal, planned end of a delegation. Use it for everything you can predict; use revocation for what you cannot.
- **Withdrawal of bond.** If the delegation references an OrangeCheck bond, the principal MAY spend the UTXOs at any time. Conforming verifiers MUST re-resolve the bond against live chain state when evaluating actions and apply `E_BOND_UNVERIFIED` if the bond decayed below the delegation's declared minimums. Withdrawal is permitted by Bitcoin and is therefore a *de facto* path to denying further actions.
- **Out-of-protocol controls.** A principal MAY hide a delegation from a reference dashboard or publish a NIP-09 deletion request. **Neither is a substitute for a revocation envelope.** A verifier evaluating an action MUST consult the canonical delegation and revocation envelopes regardless of whether the principal's dashboard shows them or whether NIP-09 deletion was requested.

### 1.2 Action (kind 30084, `d = oc-agent-act:<id>`)

- **Replacement.** Actions are content-addressed; replacement is structurally impossible.
- **Revocation.** This spec does **not** define an action-revocation envelope. An action is a record that *the agent exercised authority at a past instant*. Like an OC Stamp, allowing it to be retroactively un-recorded would defeat the verb's only function.
  - To deny *future* actions with the same delegation, the principal publishes a delegation revocation (§1.3). That does not retract actions whose effective time predates the revocation's effective time (`SPEC.md` §9.3 priority ordering).
- **OTS anchoring.** Actions whose authority might later be disputed SHOULD be OTS-anchored. The anchor time is the effective time used for revocation priority comparison (`SPEC.md` §9.3). Without OTS, the action cannot prove its priority and a verifier MUST treat any signed revocation issued before the action's declared `signed_at` as potentially effective. This is the protocol's structural answer to "but what if the agent backdates an action?"
- **Out-of-protocol controls.** Hide and NIP-09 deletion are particularly meaningless here — the action's signature remains valid wherever it has been copied.

### 1.3 Revocation (kind 30085, `d = oc-agent-rev:<revocation_id>`)

- **Replacement.** Revocations are content-addressed; replacement is structurally impossible.
- **Revocation.** A revocation is itself **non-revocable.** Once a principal has signed and published the intent to terminate a delegation, that intent is permanent. There is no "un-revoke" envelope. To re-grant authority, the principal MUST publish a *new delegation* (which will have a new `delegation_id`).
- **OTS anchoring.** Revocations SHOULD be OTS-anchored (`SPEC.md` §9.3) so their effective time is provable against a specific Bitcoin block. Without an anchor, verifiers MAY treat the revocation's `signed_at` skeptically and the priority-ordering analysis weakens.
- **Authorized revokers.** Per `SPEC.md` §9.5, only addresses listed in the delegation's `revocation.holders` may sign a valid revocation. A revocation signed by anyone else → `E_REVOKER_UNAUTHORIZED`.
- **Effect on past actions.** A revocation never retracts an action whose effective time predates the revocation's effective time. It only denies future ones. This is the priority-ordering rule from `SPEC.md` §9.3 and is what makes the verb auditable.

### 1.4 Sub-delegation (kind 30086, `d = oc-agent-sub:<subdelegation_id>`) — v1.1

- **Replacement.** Sub-delegations are content-addressed; replacement is structurally impossible. Same as §1.1.
- **Revocation.** A sub-delegation MAY be revoked by its `revocation.holders` (default: the sub-principal — i.e., the parent's agent). Revocation is via the same kind-30085 envelope as for root delegations; `delegation_id` simply points to a kind-30086 event. The revocation cascade rule (`SUB-DELEGATION.md` §3) means revoking ANY link in a chain invalidates all descendants.
- **Expiry.** Sub-delegations carry their own `expires_at`, which MUST be ≤ the parent's `expires_at`. Reaching either expiry ends the chain at that link.
- **Withdrawal of bond.** Sub-delegations cannot carry bonds. The root delegation's bond backstops the chain. If the root principal withdraws the bond, every action signed under any descendant of the root reflects that decay.
- **Re-issuance.** A sub-principal MAY issue a fresh subdelegation with a new id (e.g., to update scopes or extend within the parent's window). The old subdelegation continues to exist as its own envelope; revoking the old does not affect the new.
- **Cascade by parent revocation.** If a verifier sees a revocation against any envelope at depth `i` in a chain of length `n ≥ i`, EVERY action signed under any descendant `[i+1, n]` whose effective time post-dates the revocation fails `E_REVOKED`. This is enforced uniformly by the per-link revocation step in `SUB-DELEGATION.md` §2.2 step 5.
- **Out-of-protocol controls.** Same as §1.1 — dashboard hides and NIP-09 deletions are non-normative.

## 2. Out-of-protocol controls (cross-cutting)

The reference dashboard at [ochk.io/dashboard](https://ochk.io/dashboard) MAY offer:

- **Hide on my dashboard** — local UI filter; no protocol effect. Verifiers MUST ignore.
- **Revoke** — the dashboard's "revoke" action publishes a kind-30085 revocation envelope per §1.3, signed by an authorized revoker. This *is* a protocol-level action; it just happens to be triggered from a UI.
- **Request relay deletion** — best-effort NIP-09. Verifiers MUST ignore.

A conforming agent or verifier processes actions strictly per the delegation, revocation, and OTS-anchored priority logic in `SPEC.md` §8–§9. The dashboard's UI affordances neither extend nor override that logic.

## 3. Compliance summary

| Implementation MUST | Implementation MUST NOT |
|---|---|
| Honor a kind-30085 revocation signed by an address listed in `revocation.holders`, applying the priority-ordering rule from `SPEC.md` §9.3. | Define or honor any action-revocation envelope kind, tag, or field. |
| Treat OTS anchor time (when present) as the revocation's effective time, falling back to `signed_at` only when no anchor exists. | Treat dashboard-local hide flags or NIP-09 deletion-request events as a substitute for a kind-30085 revocation envelope. |
| Re-resolve `bond.sats` / `bond.days` against live chain state at action-evaluation time and apply `E_BOND_UNVERIFIED` if it decayed. | Pretend that revoking a delegation retracts actions whose effective time predates the revocation. |
| Refuse to sign or accept actions whose `signed_at > delegation.expires_at`. | Allow re-publishing a revocation under the same `d` to "un-revoke." There is no un-revoke. |
