# OC Agent — Security Model

A consolidated view of what the protocol proves, what it does not prove, the trust assumptions it relies on, and the threat model it targets. For the normative rules, see [`SPEC.md`](./SPEC.md) §12. This document expands on that section for implementers and auditors.

---

## 1. Summary of guarantees

A **full verification** (§SPEC 8) of an agent-action `A` against its cited delegation `D` establishes, under the usual Bitcoin cryptographic assumptions:

1. **Grant authenticity.** The holder of `D.principal.address`'s private key, at the time indicated by `D.issued_at`, produced the BIP-322 signature `D.sig.value`.
2. **Action authenticity.** The holder of `A.signer.address`'s private key, at `A.signed_at`, produced the BIP-322 signature `A.sig.value`.
3. **Delegation linkage.** `A` cites a specific delegation (`A.delegation_id === D.id`) and was signed by the delegated agent (`A.signer.address === D.agent.address`).
4. **Scope containment.** `A.scope_exercised` is a sub-scope of at least one scope in `D.scopes`, per the deterministic sub-scope relation (§SPEC 7.4).
5. **Temporal window.** `D.issued_at <= A.signed_at < D.expires_at`.
6. **Revocation absence.** No revocation effective before `A.signed_at` (per §SPEC 9.3, using OTS anchor block comparison when available) targets `D.id`.
7. **Content integrity.** If the verifier has the content bytes, `H(bytes) === A.content.hash`.
8. **Priority against revocation (when OTS-anchored).** `A` was anchored to a Bitcoin block at or before any competing revocation's anchor.
9. **Bond (when present and re-verified).** `D.principal.address` currently holds UTXOs satisfying the declared `bond.sats` × `bond.attestation_id`.

These guarantees compose. An application layer built on OC Agent can claim each separately.

## 2. What OC Agent does NOT prove

The protocol is narrow by design. It does **not** prove:

### 2.1 That the agent actually performed the declared action

A stamped agent-action proves "the agent's key signed a commitment to doing X." It does not prove X actually happened in the physical world. Downstream evidence (HTTP server logs, Lightning preimage, published Nostr event ids, received goods) is still required to confirm the action's real-world effect.

Verifiers interested in "did it happen" MAY pair an agent-action with independent evidence — e.g., hash the response body and confirm it matches a re-computed artifact. OC Agent produces the authorization artifact; it does not produce the action artifact.

### 2.2 That the action was in the principal's interest

Scope containment is necessary, not sufficient. A delegation granting `ln:send(max_sats<=1000)` admits any payment under 1000 sats within the window. Whether the specific payment was something the principal *wanted* is a higher-layer concern — the bond (§2.7) is what binds the agent's misbehavior to reputational cost.

### 2.3 Confidentiality of the grant or the action content

Delegations and agent-actions are public by construction. Any confidentiality requirement is met by **wrapping** the envelope in [OC Lock](https://github.com/orangecheck/oc-lock-protocol) to the intended recipient. The wrapped envelope gains confidentiality; the unwrapped envelope is what participates in authority verification.

### 2.4 Agent key rotation

If the agent's Bitcoin key is compromised or retired, the principal MUST issue a new delegation to a new agent address and revoke the old delegation. The protocol does not re-bind prior actions to a new agent key — actions remain signed by the key that existed when they were produced, permanently.

### 2.5 Sender / agent anonymity

All addresses in the envelope are plaintext. Anonymity requires signing from an address with no transaction history and no OrangeCheck attestation — which sacrifices the bond signal. Protocol-level mix-style anonymity is not part of v1.

### 2.6 Post-quantum authenticity

secp256k1 signatures break under a cryptographically relevant quantum adversary. A future v2 is expected to add an SLH-DSA or ML-DSA signature alongside BIP-322 for hybrid security.

### 2.7 On-chain enforcement of the bond

The bond is a **publicly auditable reputational signal**, not escrow. The declared sats remain in the principal's wallet and remain spendable. If the agent misbehaves within scope, there is no smart contract that automatically debits the bond. The guarantee the bond provides is:

- A verifier can re-resolve `bond.attestation_id` against current chain state.
- If the principal moves the UTXOs after declaring them, the attestation breaks and every past delegation citing that attestation loses its bond signal — publicly, permanently.

This is the same trust architecture as OrangeCheck itself: reputation priced in sats × time, paid for by keeping the UTXOs unspent.

## 3. Threat model

### 3.1 In-scope threats

**T1 — Forged delegation.** Attacker produces a delegation envelope claiming to come from `bc1qalice`. Mitigated by BIP-322: without Alice's private key the signature fails verification.

**T2 — Forged agent-action.** Attacker produces an action envelope claiming to come from the delegated agent. Mitigated by BIP-322 against the agent's address.

**T3 — Scope escalation.** Attacker produces an action with `scope_exercised` wider than any granted scope in the cited delegation. Mitigated by the sub-scope algorithm (§SPEC 7.4); a permissive verifier MUST still enforce sub-scope containment.

**T4 — Wrong-agent action.** Attacker attempts to use delegation D to authorize action A where A was signed by a different address. Mitigated by the `agent.address` ↔ `signer.address` equality check (§SPEC 8.3 step 10).

**T5 — Replay after expiry.** An action signed while a delegation was valid is presented after `expires_at`. Actions have their own `signed_at` (with optional OTS anchor); a verifier that requires `A.signed_at < D.expires_at` rejects the replay.

**T6 — Replay across delegations.** An action produced under delegation D1 is re-cited against a different delegation D2 with similar scopes. Mitigated by `delegation_id` being a hash of D's canonical message — no two distinct delegations have the same id.

**T7 — Revocation denial / censorship.** An attacker-friendly Nostr relay withholds a revocation from verifiers. Mitigated by recommending publication to ≥3 diverse relays; a verifier that fails to find a revocation on any relay MAY treat the delegation as still-valid, consistent with OC Lock and OC Stamp's "multi-relay redundancy" posture.

**T8 — Revocation forgery.** Attacker publishes a revocation for D claiming to come from the principal. Mitigated by the revocation's BIP-322 signature against the principal (or agent, if authorized).

**T9 — Priority manipulation.** An attacker backdates an action's `signed_at` to appear before a revocation. Mitigated by OTS anchoring: the anchor block is provable against Bitcoin headers.

**T10 — Bond misrepresentation.** A delegation declares `bond.sats = 10_000_000` but the principal does not actually hold that amount. Mitigated by attestation re-resolution: verifiers who care about the bond resolve `bond.attestation_id` against current chain state and treat any divergence as `E_BOND_UNVERIFIED`.

**T11 — Unregistered scope confusion.** Attacker crafts a scope with an unknown product/verb hoping a permissive verifier treats it as a wildcard grant. Mitigated by §SPEC 7.3: strict-mode verifiers reject unknown products/verbs; permissive mode must never treat "unknown" as "broader" — only as "ignore this scope."

**T12 — Scope-key confusion.** Attacker adds an unregistered constraint key (`lock:seal(zzz=...)`) hoping a verifier ignores it and widens the effective grant. Mitigated by §SPEC 7.6: strict-mode rejects; permissive mode ignores the key *as a constraint* without treating its absence as wider.

**T13 — Malicious aggregator / relay.** A Nostr relay modifies or reorders events. Authenticity is rooted in BIP-322 inside the envelope; relay misbehavior cannot forge signatures. Relays can only delay or hide events, which is the §T7 threat.

### 3.2 Out-of-scope threats

- **Compromise of the principal's Bitcoin key.** If an attacker holds `principal.sk`, they can issue arbitrary delegations. Key management is the wallet's responsibility.
- **Compromise of the agent's Bitcoin key.** If an attacker holds `agent.sk`, they can exercise the delegation up to its scope, expiry, and bond. Mitigations: short expiry, tight scope, agent-in-`revocation.holders` so the agent can self-revoke on suspected compromise.
- **Side-channel disclosure of action content.** The envelope's `content.hash` is public; if `content.ref` is public too, anyone who can fetch those bytes sees them. Wrap in OC Lock if confidentiality is needed.
- **Social engineering of the principal.** A principal tricked into signing a scope that looks narrow but isn't (homograph attacks, misleading UI) is outside the protocol's threat model. Mitigation: wallet UIs should render scopes in a canonical form and flag unregistered products/verbs.
- **Denial of service at the agent or verifier.** Not a cryptographic concern.

## 4. Trust assumptions

| Assumption | Dependency | Notes |
|---|---|---|
| secp256k1 signatures are unforgeable | Bitcoin | Holds at current parameter sizes under classical adversaries. |
| BIP-322 correctly implemented across address types | Signer + verifier libraries | Pin to audited implementations; cover P2WPKH, P2TR, P2WSH, P2PKH. |
| SHA-256 collision resistance | RFC 6234 | Holds at current parameter sizes. |
| OpenTimestamps calendars do not backdate | OTS | Required only if anchoring is used. Submitting to ≥2 independent calendars further reduces risk. |
| Bitcoin block headers are available to the verifier | Bitcoin / SPV / bundled headers | Full nodes, SPV clients, and pre-computed header bundles all suffice. |
| Nostr relays have at-least-one honest availability | Nostr | Publish to ≥3 diverse relays to approximate this. |
| Wallet UI faithfully renders the signing message | Wallet vendor | Out-of-scope mitigation: implementers publish canonical-message samples so users can compare. |

## 5. Implementation requirements

A compliant implementation MUST:

1. Never accept an envelope whose `v` is unknown.
2. Reconstruct the canonical message bit-for-bit from the envelope fields and compare the hash to the declared `id` before trusting any field.
3. Verify the BIP-322 signature before evaluating scopes, bonds, or any field with semantic weight.
4. Reject envelopes with unknown scope products or verbs in strict mode; log and ignore (without treating as wider) in permissive mode.
5. Compute the sub-scope relation (§SPEC 7.4) deterministically: same inputs on different implementations MUST produce the same accept/reject answer.
6. Cross-reference `A.delegation_id` with `D.id`, `A.signer.address` with `D.agent.address`, and `A.signed_at` with `D`'s temporal window before accepting.
7. Query revocation feeds (Nostr kind-30085 by `#delegation`) for the cited delegation id before reporting `OK`, unless the caller explicitly opts out of revocation checking.
8. When bond policy is in effect, re-resolve `bond.attestation_id` against current chain state — never trust the declared `sats` field alone.
9. Produce error codes per §SPEC 11.

A compliant implementation SHOULD:

- Anchor agent-actions to OpenTimestamps when the delegation is high-stakes or long-lived.
- Anchor revocations to OpenTimestamps when priority ordering against an action is anticipated.
- Publish delegations to at least three diverse Nostr relays.
- Wrap sensitive delegations in OC Lock rather than publishing them in the clear.
- Render scope strings to the user in canonical form before signing.

## 6. Reporting vulnerabilities

Security concerns: open a private security advisory on [github.com/orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol) or email `security@ochk.io`.

Do not file vulnerabilities as public issues.

## 7. Known limitations and future work

See [`SPEC.md`](./SPEC.md) §17 for the non-normative roadmap. v1 explicitly defers:

- Sub-delegation (agent-to-agent).
- On-chain bond slashing.
- Privacy-preserving (encrypted) scopes with public verifiability.
- Multi-principal joint delegations.
- Post-quantum hybrid signatures.
- Per-action bond increments.

Each is a spec-level addition that composes with v1 rather than breaking it.
