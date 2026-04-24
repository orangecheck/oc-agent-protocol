# OC Agent — Design Rationale

Why a new envelope family, why Bitcoin, why scope-string-based grants, and why this is the fifth primitive in the OrangeCheck stack rather than an extension of OC Stamp.

---

## The gap in the stack

The OrangeCheck family is a set of composable primitives, each one binding a verb to a Bitcoin address:

| Primitive | Verb | What it binds |
|---|---|---|
| OrangeCheck | **identity** | "This address has N sats bonded for M days." |
| OC Lock | **confidentiality** | "This payload is readable only by the device registered under this address." |
| OC Vote | **legitimacy** | "This vote was cast by an address carrying a bond, on a poll with transparent rules." |
| OC Stamp | **provenance** | "This address signed this content at this time, anchored to Bitcoin block N." |
| OC Agent | **authority** | "This address authorized this other address to take actions matching this scope set until this time." |

The first four are all about *what the principal did themselves*. OC Agent is the first primitive that concerns *what another party is allowed to do on the principal's behalf*.

You can approximate agent authority on top of the other four, but none of them make it first-class:

- You can **sign a delegation message as an OC Stamp** — but the verifier has no grammar for the scope, no revocation feed, no binding between agent key and stamped content.
- You can **encrypt delegation instructions with OC Lock** — but confidentiality ≠ authority. The envelope is readable by the intended agent; there is nothing to verify after the fact.
- You can **publish a delegation as an OrangeCheck attestation** — but attestations describe the signer, not a grant to another party.

OC Agent is the minimal additional protocol that fills that gap without forking or replacing any of the sibling products.

## Why not just use existing capability systems?

Capability-based authorization is a mature field. The choice to build a new envelope family wasn't taken lightly.

### OAuth and friends

OAuth bearer tokens work. They are also the wrong shape for this problem:

- **Identity is whatever the issuer says it is.** An OAuth token identifies the issuer's account, not an independently-verifiable key. Principal portability is zero.
- **Scope strings are issuer-specific.** Reading an OAuth token doesn't tell you what it authorizes unless you know the issuer's conventions.
- **Revocation is an issuer call.** The issuer's database is the source of truth; offline verification is impossible.
- **Stake is not part of the model.** There is no bond behind a bearer token.

OAuth fits "humans using webapps delegated to third-party services." OC Agent fits "a self-sovereign Bitcoin identity delegating to an autonomous process."

### UCAN / Biscuit / Macaroons

These are closer — they are capability tokens with programmatic scope, chained delegation, and offline verification. What they lack for our use case:

- **The issuer is typically an Ed25519 / ECDSA-on-a-server key, not a Bitcoin address.** Binding a capability to a Bitcoin key is possible but custom; it's not the default path.
- **No stake signal.** A UCAN token has no inherent cost of issuance; a bonded delegation from a 1-BTC-attestation principal has a verifiable reputational cost.
- **No native anchoring.** Priority ordering against revocations requires an anchor layer. OC Agent uses OpenTimestamps; UCAN/Biscuit do not prescribe one.
- **No canonical transport that composes with a pre-existing Bitcoin identity ecosystem.** We already have wallets, Nostr relays, OTS calendars, and an existing OrangeCheck attestation registry. A new primitive that speaks the same dialect is worth more than a general-purpose one that doesn't.

UCAN and Biscuit are excellent for what they target. OC Agent targets specifically "Bitcoin-identity-bound authority with reputational stake and offline verification."

### PGP-signed policy files

People still do this. The problems:

- PGP identity is a keyserver, which has failed every security review for twenty years.
- No revocation feed anyone queries.
- No scope grammar; the text is prose.
- No way to reference the action that exercised the policy.

The problem of agent authorization is not "nobody ever tried to write it down." It's "no one implementation succeeded at making writing it down the *default*."

## Why scope strings, not a scheme

We considered three shapes for the authorization primitive:

1. **Free-form string** — "the agent may do anything you reasonably understand to fall under 'posting to Nostr.'" Rejected: unverifiable.
2. **Embedded DSL** — a small Lisp or expression language evaluated by the verifier. Rejected: verifier complexity balloons, and a subset of real-world scopes becomes Turing-complete enough that "does S_exercised fit S_granted" is undecidable in the worst case.
3. **Declarative scope strings with a constraint registry** — shipped. The grammar is simple enough to parse in a hundred lines, powerful enough to express "send at most 1000 sats via Lightning to a specific node, ten times, until Friday," and structurally limited so that sub-scope containment is always decidable.

Scope strings are the protocol's contract with both humans and verifiers. A user reading `ln:send(max_sats<=1000, node=03abc…)` in a wallet signing prompt understands it immediately. A verifier checking `ln:send(max_sats=500, node=03abc…)` against it applies a fixed algorithm (§SPEC 7.4) and gets a deterministic answer.

The trade-off: some authorizations cannot be expressed without a new registered constraint key. That is deliberate. Adding a key requires a spec PR, which forces cross-implementation coordination. The cost is friction for exotic scopes; the benefit is that every compliant verifier knows exactly what the registered keys mean.

## Why bond the grant, not the action

An alternative would be: no bond on the delegation; each action carries its own per-action bond declaration. This looks more granular but makes verification worse:

- Each verification becomes an N-way re-resolution of attestations.
- The principal's total exposure is decoupled from what the agent did — the bond may be lower on the actions the principal cares most about.
- The OrangeCheck attestation is fundamentally a *slowly-changing signal*. Sats bonded for 180 days doesn't want to be debited per-action.

Binding the bond to the delegation is the right granularity: "I put N sats of reputation on the line to say that this agent will behave within scope until expiry." The bond is a public commitment to the grant, not to any individual act under it. Verifiers who want per-action certainty can pair an agent-action with a fresh OC Stamp from the principal confirming the specific act.

## Why OTS for priority (vs. no anchoring)

The question "does this revocation predate this action" is the one question OC Agent cannot answer purely from envelope signatures. Both sides can claim any `signed_at` they want.

Options considered:

1. **Trust declared timestamps.** Rejected: trivially forgeable.
2. **Require every action to cite a recent Bitcoin block hash.** Proposed in an early draft. Works but forces every agent to maintain a Bitcoin header source and produces brittle envelopes (a reorg changes the cited hash). Added complexity that didn't pay for itself.
3. **Compose with OpenTimestamps.** Shipped. OTS is free, permissionless, well-maintained, and already the anchor layer for OC Stamp. Reusing it means the verification infrastructure — calendars, proof parsing, header-bundle tooling — is already in the stack.

Anchoring is optional. For low-stakes or short-lived delegations, the declared `signed_at` is fine. For high-stakes ones, anchor the action and the revocation; let the verifier compare block heights.

## Why extend OC Stamp rather than inventing a new envelope

The first design had three completely separate envelope structures: one for delegations, one for actions, one for revocations. We noticed:

- Agent-actions are nearly structurally identical to stamps — canonical message, BIP-322 on the id, optional OTS, optional `content.ref`.
- Inventing a second "stamp-ish" envelope would mean duplicating the canonicalization, the OTS integration, and the Nostr discovery story.
- An OC Stamp verifier looking at an agent-action should get something useful out of it, not reject-or-ignore.

The compromise: agent-actions **are** stamps, with two extension fields (`delegation_id`, `scope_exercised`) and a different preamble. An OC Stamp verifier that treats those fields as unknown-tolerant (as the spec requires) correctly verifies the core attestation. An OC Agent verifier additionally checks the authority chain.

This makes the ecosystem story clean: one `@orangecheck/stamp-core` for the crypto primitives, with `@orangecheck/agent-core` sitting on top of it rather than beside it.

## Why Nostr kinds 30083 and 30085

The OrangeCheck family has reserved the 30078–30099 range for its addressable events. Existing assignments:

- 30078 — OrangeCheck attestation / OC Lock device record
- 30080–30082 — OC Vote poll, ballot, tally
- 30083 — **OC Agent delegation** (this spec)
- 30084 — OC Stamp envelope (shared transport for agent-actions, disambiguated by envelope `kind`)
- 30085 — **OC Agent revocation** (this spec)

Using kind-30084 for agent-action transport — rather than a fresh kind — is a consequence of the "agent-action is a stamp" design. It simplifies relay filtering for clients that want all OrangeCheck-family content and makes it impossible for a delegation to exist without a compatible action format.

## Why "every AI agent should have a Bitcoin address"

A year from now every meaningful software agent will be doing things that have economic and social consequences: writing code, signing off on content, sending payments, voting in DAOs, representing humans in negotiations. The authority layer for that work will either be:

1. A patchwork of provider-specific OAuth tokens, each with its own scope conventions, revocation story, and trust boundary. Verification requires trusting the issuer.
2. A portable, provable, bonded grant from a Bitcoin address. Verification is local.

The first is what exists today by default. The second is what OC Agent proposes as a floor — not the only way, but a *default* way that isn't tied to any platform, vendor, or account.

Binding agent authority to a Bitcoin address inherits, for free, everything the rest of the OrangeCheck stack gives us:

- A well-understood identity substrate (BIP-322).
- A staking signal with real economic cost (OrangeCheck).
- A confidentiality layer if the authority itself is sensitive (OC Lock).
- A provenance layer for each action (OC Stamp).
- A governance primitive if principal-group decisions gate the grant (OC Vote).

Agents that speak this dialect inherit the credibility of their principals' bonds, retain audit trails that survive any single provider's shutdown, and can be verified offline by anyone who understands the stack.

That is a substantially stronger posture than "whoever holds this API key."

## What this is not

OC Agent is **not** a replacement for OAuth when the principal is a webapp user and the authorizing party is a custodian. That remains a useful pattern in its own domain.

OC Agent is **not** a capability system for general-purpose distributed compute. UCAN is a better fit there.

OC Agent is **not** a legal document. A compliant envelope is not self-executing; enforcement of breach is still a social or legal matter. The bond is a reputational signal, not an escrow contract.

OC Agent **is** the authority envelope for cases where:

- The principal is self-sovereign (holds their own Bitcoin key).
- The agent is an autonomous or semi-autonomous process that needs verifiable authority.
- Verifiers want to audit without trusting any specific server.
- A reputational stake is useful as a credibility signal.

That is a real and growing domain. OC Agent makes it a first-class artifact.

---

For the normative spec, see [`SPEC.md`](./SPEC.md). For the narrative flow, see [`PROTOCOL.md`](./PROTOCOL.md). For security assumptions and threat model, see [`SECURITY.md`](./SECURITY.md).
