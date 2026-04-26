# OC Agent Protocol

**Bitcoin-identity-bound delegation and action authority for autonomous agents.**

OC Agent is a protocol for granting a software agent scoped authority from a Bitcoin address, signing each action the agent takes, and revoking the grant when needed — all as self-contained, offline-verifiable envelopes. Every AI agent, scheduled job, or automated signer gets a Bitcoin address. Every action is signed. Every authorization is bonded to real sats and priced in reputation.

An OC Agent envelope set proves four things at once:

1. **Authority grant** — a specific Bitcoin address (the **principal**) delegated a scoped action set to another Bitcoin address (the **agent**), bounded by expiry and optional OrangeCheck-referenced stake (BIP-322).
2. **Action authorship** — each action taken by the agent carries a BIP-322 signature under the agent's address, citing the delegation that authorized it.
3. **Scope containment** — the exercised scope is a deterministic narrowing of a granted scope, per a declarative scope grammar with a public constraint registry.
4. **Priority against revocation** *(optional)* — OpenTimestamps anchoring of actions and revocations lets a verifier decide, against Bitcoin block order, which came first.

Strip any one of those four and you lose a distinct property. The combination is what makes OC Agent Bitcoin-load-bearing — not substitutable on Ed25519, on a custodial OAuth issuer, or on a plain capability token.

OC Agent is a **sub-product of [OrangeCheck](https://ochk.io)**, following the same discipline as [OC Lock](https://github.com/orangecheck/oc-lock-protocol), [OC Stamp](https://github.com/orangecheck/oc-stamp-protocol), and [OC Vote](https://github.com/orangecheck/oc-vote-protocol): a single normative spec, a reference TypeScript implementation in [`oc-packages`](https://github.com/orangecheck/oc-packages), and a hosted reference client at [agent.ochk.io](https://agent.ochk.io) that you can host yourself.

## The place in the stack

| Primitive | Verb | Binds to Bitcoin address |
|---|---|---|
| [OrangeCheck](https://ochk.io) | identity | sats × days attestation |
| [OC Lock](https://github.com/orangecheck/oc-lock-protocol) | confidentiality | encrypted envelope |
| [OC Vote](https://github.com/orangecheck/oc-vote-protocol) | legitimacy | cast ballot + transparent tally |
| [OC Stamp](https://github.com/orangecheck/oc-stamp-protocol) | provenance | content-hash + OTS anchor |
| **OC Agent** *(this repo)* | **authority** | scoped delegation + per-action stamp |

OC Agent is the fifth primitive — composition, not replacement. An agent-action envelope **is** a valid OC Stamp with two extension fields; the `bond` references an OrangeCheck attestation; sensitive delegations can be wrapped in OC Lock.

## This repo

This repository is the **normative protocol specification**. No code lives here — only:

| File | What it is |
|---|---|
| [`SPEC.md`](./SPEC.md) | The normative v1 specification — three envelopes (delegation, agent-action, revocation), scope grammar, verification algorithm, error codes, compliance checklist. |
| [`PROTOCOL.md`](./PROTOCOL.md) | Narrative walkthrough with flow diagrams (delegate-act-verify, revocation-and-priority) and composition guidance for OC Lock, OC Stamp, OC Vote, Nostr, MCP, Lightning. |
| [`WHY.md`](./WHY.md) | Design rationale. Why a fifth primitive, why not OAuth / UCAN / PGP policy files, why scope strings, why bond the grant, why extend OC Stamp. |
| [`SECURITY.md`](./SECURITY.md) | Threat model (T1–T13), trust assumptions, implementation requirements, vulnerability reporting. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Version history. |

## Reference implementation

The TypeScript reference implementation is published to **npm**, maintained in the [`oc-packages`](https://github.com/orangecheck/oc-packages) monorepo:

| Package | npm | Purpose |
|---|---|---|
| [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core) | ![npm](https://img.shields.io/npm/v/@orangecheck/agent-core?label=) | Canonical messages, envelope format, scope grammar parser, `verifyDelegation()`, `verifyAction()`, `verifyRevocation()`. Loads `test-vectors/` for conformance. |
| [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer) | ![npm](https://img.shields.io/npm/v/@orangecheck/agent-signer?label=) | `createDelegation()`, `signAsAgent()`, `revoke()`. Composes BIP-322 signing via `@orangecheck/wallet-adapter` and OTS anchoring via `@orangecheck/stamp-ots`. |
| [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp) | ![npm](https://img.shields.io/npm/v/@orangecheck/agent-mcp?label=) | MCP tool wrapper — every invocation emits an agent-action stamped with the invocation's canonicalized arguments. |

```
npm i @orangecheck/agent-core @orangecheck/agent-signer
```

## Test vectors

The [`test-vectors/`](./test-vectors/) directory holds cross-implementation conformance fixtures. Each vector is a fixed input (principal, agent, scopes, bond, timestamps, nonce) plus the expected canonical message, envelope id, and signing-target bytes. A conforming implementation produces byte-identical envelopes for every vector. See [`test-vectors/README.md`](./test-vectors/README.md).

## Reference web client

A live reference implementation of OC Agent v1 runs at **[agent.ochk.io](https://agent.ochk.io)** (closed-source web client; the underlying protocol implementation is published as [`@orangecheck/agent-*`](https://www.npmjs.com/org/orangecheck) on npm).

The reference client supports:

- Creating delegations in-browser, signed with any BIP-322 wallet (UniSat, Xverse, Leather, or pasted signature).
- Managing an agent's device (same IndexedDB discipline as OC Lock) so a browser-resident agent can sign its own actions.
- Verifying any delegation, action, or revocation envelope — drag-drop, paste, URL fragment, or Nostr id.
- Inspecting the scope grammar, revocation chain, and OTS anchor state for any envelope.

## How it works (one paragraph)

A principal opens their wallet, reviews a canonical delegation message — `oc-agent:delegation:v1` preamble, principal address, agent address, sorted scope strings, bond sats, OrangeCheck attestation id, issued-at, expires-at, nonce — and signs it once with BIP-322. The signed bytes become a `.delegation` envelope, optionally published to Nostr as a kind-30083 event for public discovery. When the agent acts, it produces an `.action` envelope: a strict extension of OC Stamp with two extra lines in the canonical message citing the delegation id and the specific scope exercised. The agent optionally anchors the action to OpenTimestamps. If the principal loses trust in the agent, they sign a `.revocation` envelope (kind-30085) which another verifier can order against the action by OTS anchor block. Verification is a pure function of envelopes plus Bitcoin block headers: no server, no lookup, no dependency on ochk.io.

## How it works (diagram)

```
┌────────────────────────┐        ┌───────────────────┐        ┌─────────────────┐
│ Principal Bitcoin addr │────>───│ Delegation envelope│ ─────>│  Agent process  │
│  (BIP-322 signer)      │        │   kind=30083       │        │ (BIP-322 signer)│
└────────────────────────┘        │   scopes + bond    │        └────────┬────────┘
                                  │   issued/expires   │                 │
                                  └─────────┬──────────┘                 │
                                            │                            │
                                            ▼                            ▼
                                   ┌────────────────┐          ┌─────────────────┐
                                   │ Nostr relays   │          │ Agent-action    │
                                   │ (public, opt.) │          │ envelope        │
                                   └────────────────┘          │  kind=30084     │
                                            │                   │  delegation_id │
                                            │                   │  scope_exercised│
                                            │                   │  OTS anchor    │
                                            │                   └───────┬─────────┘
                                            │                           │
                          ┌─────────────────┴───────────────────────────┤
                          ▼                                             ▼
                  Verifier runs §SPEC 8                          (optional revoke:
                  purely on envelopes +                           kind=30085, OTS)
                  Bitcoin headers. Local.
```

## Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│  agent.ochk.io          create / sign / exercise / verify UI            │
│  agent-mcp              MCP tool wrapper that stamps every invocation   │
├─────────────────────────────────────────────────────────────────────────┤
│  @orangecheck/agent-core     canonical msgs, scopes, verification       │
│  @orangecheck/agent-signer   create/sign/revoke with wallet + OTS       │
├─────────────────────────────────────────────────────────────────────────┤
│  @orangecheck/stamp-core     agent-action base (OC Stamp)               │
│  @orangecheck/stamp-ots      OTS anchoring for actions + revocations    │
├─────────────────────────────────────────────────────────────────────────┤
│  OrangeCheck          bond signal via attestation_id                    │
│  OpenTimestamps       priority-ordering anchor                          │
│  Nostr                delegation/revocation directory (30083/30085)     │
│  Bitcoin              address ownership (BIP-322)                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Related repositories

- [`orangecheck/oc-packages`](https://github.com/orangecheck/oc-packages) — the `@orangecheck/agent-*` packages live here alongside the rest of the OrangeCheck SDK.
- [agent.ochk.io](https://agent.ochk.io) — hosted reference web client (closed-source).
- [`orangecheck/oc-lock-protocol`](https://github.com/orangecheck/oc-lock-protocol), [`orangecheck/oc-stamp-protocol`](https://github.com/orangecheck/oc-stamp-protocol), [`orangecheck/oc-vote-protocol`](https://github.com/orangecheck/oc-vote-protocol) — sibling primitives.
- [ochk.io](https://ochk.io) — OrangeCheck umbrella site.

## Status

v1.0 — spec-stable.

## Positioning

OC Agent is designed to **compose with, not replace**, existing authority primitives:

- **OAuth / OIDC** — fits "humans delegating to third-party services under an issuer's account system." OC Agent fits "self-sovereign Bitcoin identity delegating to an autonomous process with offline-verifiable authority and a reputational bond." Different problem, different surface.
- **UCAN / Biscuit / Macaroons** — excellent capability tokens with offline verification; OC Agent adds Bitcoin-address-bound identity, a reputational stake via OrangeCheck, and native priority-ordering via OpenTimestamps. Use UCAN when you're building on arbitrary Ed25519 identities; use OC Agent when you're building on a Bitcoin wallet.
- **PGP-signed policy files** — authorship without bonded reputation, without a revocation feed anyone queries, without a parseable scope grammar. OC Agent uses the wallet the principal already holds.
- **MCP native permissions** — OC Agent wraps MCP invocations so each one produces a verifiable authority artifact that outlives the session. The two layers compose cleanly via [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp).

See [`WHY.md`](./WHY.md) for the full design rationale.

## License

The specification and prose are MIT; see [LICENSE](./LICENSE). The reference implementation in `oc-packages` is also MIT.
