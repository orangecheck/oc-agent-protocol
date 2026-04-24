# OC Agent Protocol — Narrative Walkthrough

A tour of the three envelope types, two typical flows (delegation → action, revocation), and how they compose with the rest of the OrangeCheck stack. For the normative rules, see [`SPEC.md`](./SPEC.md).

---

## The shape of the problem

An "agent" — any software that acts on behalf of a human — has two credibility problems the moment it reaches outside its own process:

1. **Who authorized this?** A counterparty receiving an email, an API call, a Lightning payment, or a signed artifact from an agent needs to know the principal actually authorized it. Shared secrets, bearer tokens, and session cookies all collapse to "the holder of this string is blessed," which means the string leaks and authority drifts.

2. **Under what terms?** Authority is never total. A principal granting an agent "send up to 1000 sats via Lightning to node X, until Friday, for a total of ten transactions" needs that envelope to be the artifact the agent carries — not a legal paragraph nobody verifies.

OC Agent is a protocol that binds both to a Bitcoin address. The principal signs a **delegation**. The agent signs each **action**, citing the delegation. Either side can publish a **revocation**. Everything is a self-contained envelope; nothing requires talking to an OrangeCheck server to verify.

This is the same pattern as the rest of the stack:

- **OrangeCheck** binds *identity* to a Bitcoin address.
- **OC Lock** binds *confidentiality* to a Bitcoin address.
- **OC Vote** binds *legitimacy* to a Bitcoin address.
- **OC Stamp** binds *provenance* to a Bitcoin address.
- **OC Agent** binds *authority* to a Bitcoin address.

## Three envelopes

### Delegation — the grant

A delegation is a statement from a principal's Bitcoin address:

> I, `bc1qprincipal…`, authorize `bc1qagent…` to perform actions matching scope set S, bonded at 250,000 sats × 180 days under my OrangeCheck attestation, until Friday 2026-04-29T12:00Z.

That statement is serialized into a canonical message (§SPEC 4.1), hashed to produce an envelope id, signed via BIP-322 by the principal, and written into a JSON envelope. The envelope is one artifact — it travels over any medium that can carry bytes: a URL fragment, an email, a QR code, a Nostr event, an MCP tool result.

The **scope set** is not a sentence. It is a list of declarative strings like `lock:seal(recipient=bc1qalice)` or `ln:send(max_sats<=1000, node=03abc…)`. Scopes are compact, human-legible, and deterministically comparable — the same grammar a verifier can parse without ambiguity (§SPEC 7).

### Agent-action — the exercise

When the agent does something under a delegation, it produces an **agent-action** envelope. Structurally this is an OC Stamp envelope (same canonical-message discipline, same BIP-322 signing, same optional OpenTimestamps anchoring) with two extra lines in the canonical message:

```
oc-agent:action:v1
address: bc1qagent…
content_hash: sha256:deadbeef…
content_length: 4096
content_mime: application/vnd.oc-lock+json
signed_at: 2026-04-22T12:05:00Z
delegation_id: <64-hex of the delegation envelope's id>
scope_exercised: lock:seal(recipient=bc1qalice)
```

The action commits to:

- What the agent did (`content.hash`, `content.length`, `content.mime`).
- When it did it (`signed_at`; OTS anchor if present).
- Which delegation authorized it (`delegation_id`).
- Which granted scope it exercised (`scope_exercised`).

The agent's BIP-322 signature on the hex form of this envelope id makes the action non-repudiable — anyone with the envelope can prove the agent's key signed it.

### Revocation — the burn

If the principal loses trust in the agent, or the agent's key is compromised, or the job simply concludes early, a **revocation** kills the delegation:

```
oc-agent:revocation:v1
address: bc1qprincipal…
delegation_id: <64-hex>
reason: agent key rotated
signed_at: 2026-04-22T14:00:00Z
```

Revocations are OTS-anchored when possible so their effective time is provable against a specific Bitcoin block — which matters when an action and a revocation both happen on the same day and a third party has to decide which one was first.

## Flow 1 — Delegate, act, verify

```
┌──────────┐      delegation envelope               ┌─────────┐
│ Principal│───── (BIP-322 by principal) ──────────>│  Agent  │
│  Wallet  │     carries scopes + expiry + bond     │ Process │
└────┬─────┘                                        └────┬────┘
     │                                                   │
     │   publish Nostr kind-30083 (optional, public)     │
     ├──────────────────────────────────────────────>    │
     │                                                   │
     │                                                   │
     │                                            action │
     │                                    (BIP-322 by    │
     │                                       agent,      │
     │                                   cites delegation│
     │                                          id)      │
     │                                                   ▼
     │                                             ┌──────────┐
     │                                             │ Verifier │
     │                                             │ (offline)│
     │                                             └──────────┘
     │                                                   │
     │   (verifier fetches delegation from Nostr         │
     │    by delegation_id if not bundled with action)   │
     │                                                   │
     │   run §SPEC 8.1–8.3 with envelope + headers      │
     │                                                   │
     ▼                                                   ▼
 bond attestation                                  OK { principal, agent,
 (re-resolved on-chain if caller cares)              scope, content, anchor }
```

**Step by step:**

1. Principal picks scopes. "My posting agent needs `nostr:publish(relay=wss://relay.damus.io, kind=1, max_bytes=4096)` for one week."
2. Principal's wallet opens a signing prompt containing the canonical delegation message. The principal reviews — scopes, expiry, bond — and signs.
3. The signed envelope is delivered to the agent (over OC Lock, email, MCP tool call, whatever).
4. The agent stores the delegation. Optionally the principal publishes a Nostr kind-30083 event for public discovery.
5. The agent composes its action, hashes the content, signs the canonical action message.
6. The agent produces an agent-action envelope. Optionally anchors to OpenTimestamps.
7. The verifier — a counterparty, an auditor, the principal themselves — runs the algorithm in §SPEC 8:
   - Verify the delegation signature + scope grammar + expiry + revocation status.
   - Verify the action signature + stamp fields.
   - Check `delegation_id` match, agent address match, signed_at in window, scope containment.
   - (Optionally) re-resolve the bond attestation.

The entire verification is local. No ochk.io endpoint is contacted. No one's service can fabricate, silence, or censor the result.

## Flow 2 — Revocation and priority

```
   ┌──────────┐  time →
t0 │          │
   │ Principal│──── delegate ────>───┐
   │          │                      │                 relays +
   └──────────┘                      │               OTS calendars
                                     │                   ↓
                                ┌────┴────┐         ┌─────────┐
t1                              │ Agent   │────── action ────>│
                                │ signs   │       (anchored at│
                                │ action  │           block X)│
                                └────┬────┘         └─────────┘
                                     │
                                     │
   ┌──────────┐                      │
t2 │ Principal│──── revoke ────>─────┼─── anchored at block Y │
   │          │                      │                        │
   └──────────┘                      │                        ▼
                                     │              ┌──────────────┐
                                     │              │   Verifier   │
                                     │              │              │
                                     │              │ X < Y ? OK.  │
                                     │              │ X ≥ Y ? REVOKED
                                     │              │  — reject.   │
                                     │              └──────────────┘
```

The verifier compares the action's OTS anchor block to the revocation's. If the action predates the revocation, it stands. If the action isn't OTS-anchored but a revocation exists that predates the action's declared `signed_at`, the verifier MUST treat the action as suspect — the agent's "I signed this before you revoked" claim is not provable against Bitcoin.

This is why OC Agent **strongly recommends OTS anchoring** of both actions and revocations for any high-stakes delegation. OTS is free, permissionless, and composes cleanly — exactly the sort of dependency we want.

## Composing with the rest of the stack

### With OC Lock

A principal may wish to keep the delegation itself confidential — its scopes reveal what the agent is for, and that can be sensitive. Solution: encrypt the delegation envelope with OC Lock to the agent's device public key. The delegation travels as an OC Lock envelope; the agent decrypts, stores, and uses it normally.

Likewise, the payload of an agent-action (what the agent actually said in its Nostr post, the body of an HTTP request, the Lightning invoice) may be sealed with OC Lock to specific recipients while the stamped envelope remains publicly auditable.

### With OC Stamp

Every agent-action **is** an OC Stamp with two extra lines in the canonical message and one extra tag (`kind=agent-action`). A verifier with only an OC Stamp implementation reads the core attestation — authorship, content hash, priority — correctly. Authority verification requires OC Agent; core provenance verification does not.

This lets OC Agent ride on OC Stamp's infrastructure: the same OTS calendars, the same Nostr relays, the same canonical JSON tools.

### With OC Vote

A principal can delegate `vote:cast(poll_id=<hex>, choice=yes)` to an agent — "vote yes on this specific poll for me." The agent produces an agent-action whose content is an OC Vote envelope. Anyone verifying the poll sees the agent cast the vote, backed by a delegation, backed by the principal's OrangeCheck bond.

### With OrangeCheck

The `bond.attestation_id` in a delegation points to an OrangeCheck canonical message signed by the principal. Verifiers who care about stake resolve that id, re-verify the UTXO holdings on-chain, and treat the bond as a live signal — not a stored number.

### With MCP, Nostr clients, and other ecosystems

Because an agent-action is a small, self-contained JSON object, it drops into any RPC surface:

- An **MCP tool wrapper** takes a tool invocation, produces an agent-action envelope whose `content.hash` is the hash of the tool name + serialized arguments, and stamps it. The MCP server sees a verifiable "agent X, authorized by principal Y under scope `mcp:invoke(server=…, tool=…)`, called me with these bytes."
- A **Nostr kind-1 post by a software agent** can be paired with an agent-action whose content is the post's event id. The post itself remains kind-1; a companion kind-30084 event (or a reply tag) carries the stamp. Feed readers that understand OC Agent surface a badge: "posted by agent of @principal, scope `nostr:publish(kind=1)`, expires 2026-04-29."
- A **Lightning agent** signs each outgoing payment as an agent-action whose `content` is the payment hash. Counterparties see a pay-then-stamp artifact proving the payment was authorized under a specific delegation.

## What this replaces (and what it doesn't)

**Replaces:** ad-hoc "tool authentication" layers. Static API tokens that drift. Handwritten legal paragraphs nobody verifies. Shared browser sessions delegated to automation. Bearer tokens minted by custodians whose auditing surface is an implementation detail.

**Does not replace:** the underlying transports. OC Agent does not send HTTP, publish Nostr events, pay invoices, or invoke tools. It produces verifiable envelopes *about* those actions. The agent still uses whatever transport the task requires; the protocol layers a citable authority on top.

## Design constants

A handful of rules hold across every envelope and every verification path:

1. **Bitcoin address is identity, end of story.** No usernames. No OAuth. No provider-specific accounts.
2. **BIP-322 on a hex id is the signature.** Wallets already sign messages; we give them a short, legible message to sign.
3. **Verification is a pure function of envelopes + (optional) Nostr + Bitcoin headers.** No ochk.io endpoint is required at verify time.
4. **Every envelope is a single JSON object.** Serializable, URL-fragment-able, QR-able, archivable.
5. **Scope strings are parseable, comparable, and composable.** No free-form prose in the place that governs what the agent may do.
6. **Revocation is always available, always citable.** And it's priority-ordered by OTS anchor when anchoring is used.
7. **Stake is optional but first-class.** A delegation with a bond is publicly auditable as "the principal put N sats of reputation on the line."

---

For the full normative rules, start at [`SPEC.md`](./SPEC.md). For the design rationale — why a new envelope family rather than reusing an existing capability system — read [`WHY.md`](./WHY.md).
