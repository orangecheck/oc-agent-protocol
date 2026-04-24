# OC Agent Protocol v1.0 — Specification

**Status:** Stable
**Date:** 2026-04
**Related:** [OrangeCheck](https://ochk.io/docs/spec) (identity + stake), [OC Lock v2](https://github.com/orangecheck/oc-lock-protocol) (private envelopes), [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol) (content attestation + OTS anchoring), [OC Vote v1](https://github.com/orangecheck/oc-vote-protocol) (legitimate polls)

---

## 0. Notation

- All bytes serialized as lowercase hex unless marked `base64` or `base64url`.
- `||` denotes byte concatenation.
- `H()` = SHA-256 (RFC 6234).
- `BIP322(addr, msg)` = BIP-322 signature of `msg` by `addr`, encoded as base64.
- Canonical JSON = UTF-8 encoded JSON with lexicographically sorted object keys, no insignificant whitespace, LF-terminated. See §6.
- ISO 8601 UTC means `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`, always ending in `Z`.
- `sats` is an integer count of satoshis (100,000,000 sats = 1 BTC).
- Unix time means integer seconds since the POSIX epoch.

## 1. Actors

- **Principal** — the party who grants authority. Holds a Bitcoin address capable of BIP-322 signing. Writes **delegations** and **revocations**.
- **Agent** — the party acting under delegated authority. Also holds a Bitcoin address capable of BIP-322 signing. Signs **agent-actions** referencing a delegation. Typically a software agent (AI, scheduled job, robo-signer), but the protocol makes no assumption about the agent's nature.
- **Verifier** — any party reading an agent-action to confirm authority, scope, and (optionally) stake. Never consults a proprietary endpoint; verification is a pure function of the envelopes plus Nostr / OTS / Bitcoin chain data available to the verifier.
- **Directory** — a Nostr relay (or set of relays) that stores published delegation and revocation events for durable public discovery. Optional — delegations MAY travel out-of-band.

A principal MAY delegate to themselves (a "self-agent": same Bitcoin address as principal and agent). A principal MAY delegate to multiple agents; an agent MAY hold delegations from multiple principals.

## 2. Identities

All actors are identified by **mainnet Bitcoin addresses** (P2WPKH, P2TR, or P2PKH). The address is the full identity: there are no usernames, keyservers, or accounts in the protocol.

A delegation MAY include an optional **OrangeCheck attestation reference** (`bond.attestation_id`) binding the delegation to a declared sats-bonded × days-unspent signal at the moment of issuance. The reference is **self-declared** and **re-verifiable**: a verifier that cares about stake MUST re-resolve the attestation against current chain state rather than trusting the declared values.

An agent address SHOULD be distinct from the principal's address in typical deployments. Same-address self-delegation is permitted and useful for intent declarations ("I am about to do X").

## 3. Envelope family

OC Agent defines three envelope types. All three share the canonical-message / BIP-322 / Nostr publication discipline of the rest of the OrangeCheck stack.

| Envelope | `kind` | Nostr kind | Purpose |
|---|---|---|---|
| **Delegation** | `agent-delegation` | 30083 | Principal grants an agent authority over a scoped action set, bounded by expiry and optional stake. |
| **Agent-action** | `agent-action` | (stamp 30084) | Agent executes an action within a granted delegation; produces a stamped envelope that cites the delegation. Reuses [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol) envelope structure with extension fields. |
| **Revocation** | `agent-revocation` | 30085 | Principal (or delegated revocation holder) burns a delegation ahead of its natural expiry. |

Delegation and revocation kinds 30083 and 30085 are claimed exclusively by this spec in the OrangeCheck family's 30078–30099 range (30078 = OrangeCheck attestation / OC Lock device record, 30080–30082 = OC Vote, 30084 = OC Stamp — both OC Stamp and OC Agent actions share the 30084 transport, disambiguated by envelope `kind`).

Each envelope is independently verifiable:

- A **delegation** is authentic iff its BIP-322 signature verifies under the principal's address.
- An **agent-action** is authentic iff (a) its BIP-322 signature verifies under the agent's address and (b) the referenced delegation verifies and (c) the action's scope exercise is within the delegation's granted scope set.
- A **revocation** is authentic iff its BIP-322 signature verifies under the principal's address (or, if the delegation granted it, the agent's address).

## 4. Delegation envelope

A **delegation** is a single canonical JSON object referred to by file extension `.delegation` and MIME type `application/vnd.oc-agent.delegation+json`.

### 4.1 Canonical message (principal-signed)

The principal's BIP-322 signature commits to this exact byte sequence:

```
oc-agent:delegation:v1
principal: <btc_address>
agent: <btc_address>
scopes: <scope_1> || "," || <scope_2> || "," || …
bond_sats: <non-negative integer, decimal; 0 if unbonded>
bond_attestation: <64-hex OrangeCheck attestation id | "none">
issued_at: <ISO 8601 UTC>
expires_at: <ISO 8601 UTC>
nonce: <32-hex>
```

Each line is terminated by a single LF (`0x0a`). There is no trailing LF after the `nonce` line. The first line is the literal 22-byte string `oc-agent:delegation:v1` — a domain separator that prevents cross-envelope signature replay.

Scopes are serialized in **sorted order** (lexicographic byte order) and joined by a single ASCII comma (`0x2c`). Scope grammar is §7.

### 4.2 Envelope id

```
id := H(canonical_message_bytes)
```

`id` is 32 bytes, serialized in the envelope as 64 lowercase hex characters. `id` is also the BIP-322 signing target (hex-encoded ASCII, per §4.5).

### 4.3 Envelope schema

```json
{
  "v": 1,
  "kind": "agent-delegation",
  "id": "<64-hex>",

  "principal": {
    "address": "bc1q…",
    "alg": "bip322"
  },

  "agent": {
    "address": "bc1q…",
    "alg": "bip322"
  },

  "scopes": ["lock:seal(recipient=bc1q…)", "stamp:sign(mime=text/markdown)"],

  "bond": {
    "sats": 250000,
    "attestation_id": "<64-hex OrangeCheck attestation id>"
  } | null,

  "issued_at": "2026-04-22T12:00:00Z",
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

### 4.4 Field rules

| Field | Rule |
|---|---|
| `v` | Integer. Current version is `1`. Verifiers MUST reject unknown versions. |
| `kind` | MUST equal `"agent-delegation"`. |
| `id` | MUST equal `H(canonical_message)` as hex (§4.2). |
| `principal.address` | MUST match `principal` in the canonical message. |
| `principal.alg` | MUST equal `"bip322"` in v1. |
| `agent.address` | MUST match `agent` in the canonical message. |
| `agent.alg` | MUST equal `"bip322"` in v1. |
| `scopes` | Non-empty array of scope strings. Each MUST be valid per §7. Serialized in sort order for the canonical message. |
| `bond.sats` | MUST match `bond_sats` in the canonical message. Non-negative integer. |
| `bond.attestation_id` | Required if `bond` is non-null. MUST be the sha256 of an OrangeCheck canonical message signed by `principal.address`. |
| `issued_at`, `expires_at` | MUST match the canonical message. `expires_at > issued_at`. `expires_at - issued_at ≤ 365 days`. |
| `nonce` | 32 hex chars, uniformly random. Prevents replay of identical-content delegations. |
| `revocation.holders` | Array of `"principal"` and/or `"agent"`. Default `["principal"]`. If present, signals who MAY publish a §9 revocation. |
| `revocation.ref` | Optional Nostr-addressable pointer to a revocation event. Non-cryptographic convenience. |
| `sig.alg` | MUST equal `"bip322"` in v1. |
| `sig.pubkey` | MUST equal `principal.address`. |
| `sig.value` | MUST verify under BIP-322 as a signature by `principal.address` over the hex-encoded `id` (64 ASCII bytes). |

### 4.5 Signing

The BIP-322 signature commits to the **hex string** of the envelope id (64 ASCII bytes, lowercase):

```
sig.value := BIP322(principal.address, hex(id))
```

The hex form is used (not raw bytes) so wallet UIs can display the signed message to the user for confirmation. The id transitively commits to the canonical message, hence every signed field.

## 5. Agent-action envelope

An **agent-action** is a single canonical JSON object that proves an agent executed a specific action under a specific delegation. It is a **strict extension of [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol)**: the base fields (`content`, `signer`, `signed_at`, `ots`, `sig`) are identical, so any OC Stamp verifier reads and verifies the core attestation without OC Agent knowledge. Two extension fields (`delegation_id`, `scope_exercised`) carry the authority citation.

### 5.1 Canonical message (agent-signed)

```
oc-agent:action:v1
address: <agent_btc_address>
content_hash: sha256:<64-hex>
content_length: <positive integer, decimal>
content_mime: <RFC 6838 media type; "application/octet-stream" if unknown>
signed_at: <ISO 8601 UTC>
delegation_id: <64-hex>
scope_exercised: <scope string>
```

Each line LF-terminated; no trailing LF after `scope_exercised`. The first line is the literal 18-byte string `oc-agent:action:v1` — a domain separator distinct from OC Stamp's `oc-stamp:v1`. An OC Stamp verifier that does not recognize the `oc-agent:action:v1` preamble treats the envelope as an OC Stamp with extension fields (per unknown-field tolerance, §6.3) and still reports correct authorship and priority; only authority verification (§8.3) requires OC Agent support.

### 5.2 Envelope id

```
id := H(canonical_message_bytes)
```

### 5.3 Envelope schema

```json
{
  "v": 1,
  "kind": "agent-action",
  "id": "<64-hex>",

  "content": {
    "hash": "sha256:<64-hex>",
    "length": 12843,
    "mime": "application/vnd.oc-lock+json",
    "ref": "ipfs://bafy…" | "https://…" | null
  },

  "signer": {
    "address": "<agent_btc_address>",
    "alg": "bip322"
  },

  "signed_at": "2026-04-22T12:05:00Z",

  "delegation_id": "<64-hex>",
  "scope_exercised": "lock:seal(recipient=bc1q…)",

  "ots": {
    "status": "pending" | "confirmed",
    "proof": "<base64 OpenTimestamps proof>",
    "calendars": ["https://alice.btc.calendar.opentimestamps.org"],
    "block_height": <integer | null>,
    "block_hash": "<64-hex | null>",
    "upgraded_at": "<ISO 8601 UTC | null>"
  } | null,

  "sig": {
    "alg": "bip322",
    "pubkey": "<agent_btc_address>",
    "value": "<base64 BIP-322 signature>"
  }
}
```

### 5.4 Field rules

- All base rules (`content.*`, `signer.*`, `signed_at`, `ots`, `sig`) are identical to OC Stamp §4.2. The canonical message differs only in preamble and in two appended lines (`delegation_id`, `scope_exercised`); the id derivation is unchanged.
- `delegation_id` MUST be the id of a delegation envelope whose `agent.address` equals `signer.address`.
- `scope_exercised` MUST be one of the scope strings in that delegation's `scopes` array, **or** a valid sub-scope per the grammar's constraint-tightening rules (§7.4). A sub-scope strictly narrows the delegated scope; it MUST NOT widen it.
- `sig.value` MUST verify under BIP-322 as a signature by `signer.address` over the hex-encoded `id`.

### 5.5 OTS anchoring

Anchoring is **optional but recommended** for agent-actions. Anchoring serves two purposes:

1. **Priority.** Establishes that the action predated any subsequent revocation of the delegation (§9.3).
2. **Durability.** Makes the action publicly auditable regardless of whether any Nostr relay still carries it.

When anchored, the procedure is identical to OC Stamp §6: submit `id` to one or more OTS calendars; upgrade the proof to confirmed when the anchor block is mined.

## 6. Canonicalization

Canonical envelope bytes are required for test-vector conformance, Nostr event content, and any future operations that need deterministic envelope serialization.

Canonical form (per [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)):

- UTF-8 JSON with keys sorted lexicographically at every level.
- No insignificant whitespace.
- Arrays preserve order **except** the top-level `scopes` field in a delegation, which MUST be sorted lexicographically to match the canonical-message serialization.
- Numbers serialized with no fractional zeros and no exponents for integers within IEEE 754 double range.
- Strings serialized with `\uXXXX` escapes only for control characters and `"` / `\`.
- Final byte is LF (`0x0a`).

### 6.3 Unknown-field tolerance

Verifiers MUST preserve unknown top-level fields when relaying envelopes but MAY ignore them when verifying. Incompatible changes increment `v` (§10).

## 7. Scope grammar

A **scope string** is a compact declarative statement of the form:

```
<product>:<verb>(<constraint-list>)
```

Scopes are the protocol's contract for "what may this agent do, and on what terms." They are designed to be human-legible, composable across OrangeCheck sub-products, and deterministically comparable for sub-scope relationships.

### 7.1 Lexical form (BNF)

```
scope         := product ":" verb [ "(" constraint-list ")" ]
product       := lowercase-ident
verb          := lowercase-ident
constraint-list := constraint ( "," constraint )*
constraint    := key op value
key           := lowercase-ident
op            := "=" | "!=" | "<" | "<=" | ">" | ">=" | "*"
value         := quoted-string | bare-token
quoted-string := "\"" <UTF-8, escaping "\" and "\""> "\""
bare-token    := [A-Za-z0-9_.:/@+\-]+
lowercase-ident := [a-z][a-z0-9_]*
```

Whitespace is **not** permitted inside a scope string. The `*` op is the **wildcard** and takes no value; it means "any value for this key."

### 7.2 Canonical form of a scope string

To make sub-scope comparison deterministic, scopes are canonicalized before use:

1. Constraints are sorted lexicographically by key.
2. Bare tokens are lowercased unless the constraint's registered key (§7.6) is case-sensitive.
3. Redundant whitespace is removed (there should be none after lexing).

The canonical form is the exact byte sequence recorded in `scopes` / `scope_exercised`.

### 7.3 Registered MVP scopes

Implementations MUST accept these products and verbs. A scope with an unknown product or verb is **rejected** by conservative verifiers (ok to treat as "no authority granted") and MAY be accepted by permissive verifiers that know about extensions.

| Scope | Semantics |
|---|---|
| `lock:seal` | Encrypt and send an OC Lock envelope to a recipient. |
| `lock:chat` | Send an OC Lock chat message over Nostr. |
| `stamp:sign` | Produce an OC Stamp envelope over content. |
| `vote:cast` | Cast a vote in an OC Vote poll. |
| `nostr:publish` | Publish a Nostr event under the agent's Nostr key. |
| `http:request` | Issue an HTTP request to a target origin. |
| `ln:send` | Initiate a Lightning payment. |
| `mcp:invoke` | Invoke an MCP tool. |

Registered constraint keys per scope are §7.6.

### 7.4 Sub-scope relation

A scope `S_exercised` is a **sub-scope** of delegated scope `S_granted` iff:

1. `product` and `verb` are identical.
2. For every constraint `(k, op, v)` in `S_granted`:
   - If `op = "*"` in `S_granted`: no requirement on `S_exercised` for key `k`.
   - If `op = "="` in `S_granted`: `S_exercised` MUST contain `(k, "=", v)` exactly.
   - If `op = "!="` in `S_granted`: `S_exercised` MUST contain `(k, "=", v')` where `v' != v`, or `(k, "!=", v)`.
   - If `op ∈ {"<", "<=", ">", ">="}` in `S_granted`: `S_exercised` MUST contain `(k, op', v')` where `op'` is any of `=, <, <=, >, >=` and the implied value range of `S_exercised` is a subset of the range admitted by `S_granted`. Numeric comparison only; values MUST be decimal integers for ordered ops.
3. `S_exercised` MAY add constraints on keys not present in `S_granted`, as long as the added constraints are registered for the scope's product/verb (§7.6).

**Examples:**

- Granted `lock:seal(recipient=bc1qalice)` admits exercised `lock:seal(recipient=bc1qalice)` — exact match.
- Granted `ln:send(max_sats<=1000)` admits exercised `ln:send(max_sats=500, node=03abc…)` — tighter numeric constraint, additional registered key.
- Granted `stamp:sign(mime=text/markdown)` does **not** admit exercised `stamp:sign(mime=application/pdf)` — keys match but values differ with `=` op.
- Granted `http:request(origin=https://api.example.com)` does **not** admit exercised `http:request(origin=https://api.evil.com)`.

### 7.5 Wildcards in delegations

A delegation MAY grant `product:verb(key=*)` to express "any value for key." Wildcards widen; use them deliberately. An unbonded delegation with `http:request(*)` (no constraints) is equivalent to `http:request` — maximally permissive, which verifiers MAY reject by policy.

### 7.6 Constraint-key registry

The MVP registry; extensions allocate new keys by PR to this spec.

| Scope | Registered keys | Value type |
|---|---|---|
| `lock:seal` | `recipient`, `mime`, `max_bytes` | bare-token (btc address), mime, integer |
| `lock:chat` | `recipient`, `max_bytes_per_msg`, `max_msgs` | bare-token, integer, integer |
| `stamp:sign` | `mime`, `max_bytes`, `content_hash_prefix` | mime, integer, hex-prefix |
| `vote:cast` | `poll_id`, `choice` | hex, bare-token |
| `nostr:publish` | `kind`, `relay`, `max_bytes` | integer, url, integer |
| `http:request` | `origin`, `method`, `max_rps`, `max_bytes_out` | url, verb, integer, integer |
| `ln:send` | `max_sats`, `node`, `max_fee_sats` | integer, hex pubkey, integer |
| `mcp:invoke` | `server`, `tool`, `max_invocations` | url, bare-token, integer |

`max_*` keys are upper-bound constraints; use with ordered ops (`<`, `<=`).

A verifier encountering an **unregistered constraint key** for a registered product/verb:

- In **strict mode:** rejects the envelope.
- In **permissive mode:** ignores the unknown key (treats it as "information only, not a constraint").

Clients SHOULD default to strict mode.

## 8. Verification algorithm

A **full verification** of an agent-action envelope `A` against its cited delegation envelope `D` produces one of:

- `OK { id, agent, principal, scope, content, signed_at, anchor, bond }` — all checks passed.
- An `AgentError`-style code (see §11).

### 8.1 Verify the delegation

Given `D`:

1. **Version check.** If `D.v !== 1` → `E_UNSUPPORTED_VERSION`.
2. **Shape check.** All required fields (§4.3) present and typed correctly; else `E_MALFORMED`.
3. **Canonical consistency.** Reconstruct the canonical message from (`D.principal.address`, `D.agent.address`, sorted `D.scopes`, `D.bond?.sats | 0`, `D.bond?.attestation_id | "none"`, `D.issued_at`, `D.expires_at`, `D.nonce`). Compute `id' = H(canonical)`. If `hex(id') !== D.id` → `E_BAD_ID`.
4. **Scope grammar.** Every entry of `D.scopes` MUST parse per §7.1 and lie within the registry per §7.3 / §7.6. Else `E_BAD_SCOPE_GRAMMAR`.
5. **Signature verify.** Verify `D.sig.value` under BIP-322 as a signature by `D.principal.address` over ASCII `D.id`. If invalid → `E_BAD_SIG`.
6. **Temporal check.** If `now < D.issued_at` → `E_NOT_YET_VALID`. If `now >= D.expires_at` → `E_EXPIRED`.
7. **Revocation check.** Query §9 revocation registries for a valid revocation targeting `D.id`. If any is found and its effective time precedes `A.signed_at` (per §9.3) → `E_REVOKED`.

### 8.2 Verify the action (core)

Given `A`:

8. **Base stamp check.** Run OC Stamp §8.1 steps 1–5 against `A`, treating `A` as a stamp envelope. This produces `OK_stamp` or an error; a stamp error is returned with code `E_BAD_ACTION_STAMP`.

### 8.3 Verify authority

Given authenticated `A` and `D`:

9. **Delegation binding.** `A.delegation_id` MUST equal `D.id`. Else `E_DELEGATION_MISMATCH`.
10. **Agent binding.** `A.signer.address` MUST equal `D.agent.address`. Else `E_AGENT_MISMATCH`.
11. **Action ≤ delegation lifetime.** `D.issued_at <= A.signed_at < D.expires_at`. Else `E_OUT_OF_WINDOW`.
12. **Scope check.** `A.scope_exercised` MUST parse per §7.1 and MUST be a sub-scope (§7.4) of at least one scope in `D.scopes`. Else `E_SCOPE_DENIED`.

### 8.4 Verify bond (optional)

If caller policy requires a bond:

13. **Bond presence.** If `D.bond === null` → `E_NO_BOND`.
14. **Bond threshold.** `D.bond.sats >= caller_threshold_sats`. Else `E_BOND_UNMET`.
15. **Attestation re-resolution.** Resolve `D.bond.attestation_id` via `@orangecheck/sdk#verify` and confirm declared `sats_bonded` and `days_unspent` are still true (or still exceed the caller's policy). Else `E_BOND_UNVERIFIED`.

### 8.5 What full verification guarantees

| Check clean | Guarantee |
|---|---|
| `E_BAD_SIG` on D | Holder of `D.principal.address` at `issued_at` authorized this delegation. |
| `E_REVOKED` absent | No effective revocation predates the action's signed-at (modulo OTS anchoring, §9.3). |
| `E_BAD_ACTION_STAMP` clean | Holder of `D.agent.address` at `A.signed_at` authorized this action. |
| `E_SCOPE_DENIED` absent | The exercised scope is a legal narrowing of a granted scope. |
| `E_BOND_UNVERIFIED` absent | The principal's declared bond is currently still staked. |

Verification is entirely local: envelope + Nostr relay transcripts + Bitcoin headers. **No ochk.io endpoint is required or consulted at verify time.**

## 9. Revocation

A principal may burn a delegation before its expiry by publishing an `agent-revocation` envelope.

### 9.1 Canonical message (principal-signed, or agent-signed if §4.4 `revocation.holders` includes `"agent"`)

```
oc-agent:revocation:v1
address: <signer_btc_address>
delegation_id: <64-hex>
reason: <short ASCII string, max 128 bytes, "" if omitted>
signed_at: <ISO 8601 UTC>
```

Each line LF-terminated; no trailing LF after `signed_at`. The first line is the literal 22-byte string `oc-agent:revocation:v1`.

### 9.2 Envelope schema

```json
{
  "v": 1,
  "kind": "agent-revocation",
  "id": "<64-hex>",
  "delegation_id": "<64-hex>",
  "signer": {
    "address": "<btc_address>",
    "alg": "bip322"
  },
  "reason": "",
  "signed_at": "2026-04-22T14:00:00Z",
  "ots": { … } | null,
  "sig": {
    "alg": "bip322",
    "pubkey": "<signer.address>",
    "value": "<base64>"
  }
}
```

Revocations SHOULD be OTS-anchored so their effective time is provable against a specific Bitcoin block.

### 9.3 Effective time

A revocation is effective as of its **anchor time** if OTS-anchored, otherwise as of its `signed_at` (which verifiers MAY treat skeptically).

An action with `signed_at = t_a` and an OTS anchor at block `B_a` is **not revoked** by a revocation with anchor at block `B_r` if `B_a < B_r` (action anchored strictly earlier). If the action is not OTS-anchored, a verifier MUST treat any signed revocation issued before the action's declared `signed_at` as potentially effective — the action cannot prove its priority.

This is why OC Agent strongly recommends OTS anchoring of agent-actions whose authority might later be disputed.

### 9.4 Publication

Revocations are published as Nostr **kind-30085** events:

```
event.kind       = 30085
event.tags       = [
  ["d",              "oc-agent-rev:" || revocation_id],
  ["delegation",     delegation_id],
  ["signer_addr",    signer.address]
]
event.content    = <canonical JSON of revocation envelope>
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

A revocation crawl query:

```
REQ { "kinds": [30085], "#delegation": ["<64-hex>"] }
```

Clients SHOULD publish to the same diverse relay set they used for the delegation (§10.1).

### 9.5 Authorized revokers

The `revocation.holders` field in a delegation (§4.3) restricts who may burn it:

- `["principal"]` (default) — only the principal's Bitcoin address may sign a revocation.
- `["principal", "agent"]` — either the principal or the agent may. Useful for "agent self-revokes when compromised."

A revocation whose `signer.address` is not in the delegation's `revocation.holders` list → `E_REVOKER_UNAUTHORIZED`.

## 10. Nostr directory

For durable public discovery, delegations are published to Nostr as **kind-30083** events. This is optional — a delegation envelope is self-contained and travels over any transport.

### 10.1 Delegation event

```
event.kind       = 30083
event.tags       = [
  ["d",              "oc-agent-del:" || delegation_id],
  ["principal",      principal.address],
  ["agent",          agent.address],
  ["expires",        expires_at_unix_seconds],
  ["scope",          scope_1],
  ["scope",          scope_2], …
]
event.content    = <canonical JSON of delegation envelope>
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

The Nostr `pubkey` has no relationship to the Bitcoin identity — authenticity is proven by BIP-322 inside the envelope, not by the Nostr author. A fresh ephemeral Nostr keypair SHOULD be derived per publish:

```
nostr_sk := HKDF(ikm=random(32), salt="oc-agent/v1/nostr-key", info=delegation_id, L=32)
```

Clients SHOULD publish to at least three relays from a diverse set. Reference relays: `relay.damus.io`, `relay.nostr.band`, `nos.lol`, `relay.snort.social`.

### 10.2 Discovery queries

By principal:
```
REQ { "kinds": [30083], "#principal": ["bc1q…"] }
```

By agent:
```
REQ { "kinds": [30083], "#agent": ["bc1q…"] }
```

By delegation id:
```
REQ { "kinds": [30083], "#d": ["oc-agent-del:<id>"] }
```

By scope product (client-side filter on `#scope` tags):
```
REQ { "kinds": [30083], "#agent": ["bc1q…"] }
# then filter events where any "scope" tag starts with "lock:"
```

### 10.3 Agent-action directory

Agent-actions reuse OC Stamp's **kind-30084** envelope-transport, disambiguated by the envelope's `kind: "agent-action"`. Verifiers who want only agent-actions filter:

```
REQ { "kinds": [30084], "#kind": ["agent-action"] }
```

The `d` tag is `oc-agent-act:<id>`. A `delegation` tag echoes `delegation_id`:

```
event.tags = [
  ["d",          "oc-agent-act:" || action_id],
  ["kind",       "agent-action"],
  ["delegation", delegation_id],
  ["agent",      signer.address],
  ["scope",      scope_exercised],
  ["hash",       content.hash],
  ["signed_at",  signed_at]
]
```

## 11. Errors

Client errors MUST use these codes.

| Code | Meaning |
|---|---|
| `E_UNSUPPORTED_VERSION` | Envelope `v` is unknown. |
| `E_MALFORMED` | Envelope shape / field types / required fields invalid. |
| `E_BAD_ID` | Reconstructed canonical message does not hash to declared `id`. |
| `E_BAD_SIG` | BIP-322 signature did not verify. |
| `E_BAD_SCOPE_GRAMMAR` | A scope string failed §7.1 / §7.3 / §7.6 parsing. |
| `E_NOT_YET_VALID` | Action or delegation is referenced before `issued_at`. |
| `E_EXPIRED` | Delegation is past `expires_at` at the verification / action time. |
| `E_REVOKED` | A valid revocation predates the action per §9.3. |
| `E_DELEGATION_MISMATCH` | `A.delegation_id` does not equal `D.id`. |
| `E_AGENT_MISMATCH` | `A.signer.address` does not equal `D.agent.address`. |
| `E_OUT_OF_WINDOW` | `A.signed_at` falls outside `[D.issued_at, D.expires_at)`. |
| `E_SCOPE_DENIED` | `A.scope_exercised` is not a sub-scope of any granted scope. |
| `E_BAD_ACTION_STAMP` | Underlying OC Stamp verification failed on the agent-action. |
| `E_NO_BOND` | Caller policy required a bond; delegation has none. |
| `E_BOND_UNMET` | Declared bond sats below caller threshold. |
| `E_BOND_UNVERIFIED` | OrangeCheck attestation no longer satisfies the declared bond. |
| `E_REVOKER_UNAUTHORIZED` | Revocation signer not in delegation's `revocation.holders`. |
| `E_CALENDAR_UNREACHABLE` | Anchor upgrade required a calendar fetch that failed. |

## 12. Security model

### 12.1 What OC Agent proves

- **Authority grant.** Under the BIP-322 assumption, only the holder of `principal.address` could have issued `D`.
- **Action authorship.** Under the BIP-322 assumption, only the holder of `agent.address` could have produced `A`.
- **Scope containment.** The exercised scope is a deterministic narrowing of a granted scope (§7.4).
- **Bond at issuance (when declared and re-verified).** The principal has declared and currently carries a sats-bonded × days-unspent signal meeting the verifier's policy.
- **Priority (when OTS-anchored).** The action's envelope id existed before a specific Bitcoin block — useful to order actions against revocations (§9.3).

### 12.2 What OC Agent does NOT prove

- **That the agent's off-chain behavior matched the action's declared content.** The stamp proves "the agent signed a statement that it took action X." Whether the agent also actually sent the HTTP request, paid the invoice, published the post, etc., is a downstream question; observers MAY match the action's `content.hash` to downstream artifacts (e.g., a Nostr event id, a Lightning preimage, an HTTP response body) to confirm.
- **That the action was wise, useful, or desired.** Scope containment is necessary, not sufficient, for "good." The bond is what puts the agent at material risk for acting within scope but against the principal's intent.
- **Agent-principal communication confidentiality.** Use [OC Lock](https://github.com/orangecheck/oc-lock-protocol) to encrypt delegation instructions in transit to the agent.
- **Agent identity persistence.** Rotating an agent's Bitcoin key requires a new delegation; the protocol does not re-bind prior actions to a new key.
- **Post-quantum authenticity.** secp256k1 breaks under a sufficiently large quantum computer. No PQ layer in v1.

### 12.3 Trust assumptions

- **Bitcoin's security model holds.** secp256k1 signatures remain unforgeable.
- **BIP-322 is implemented correctly** by signing and verifying clients across address types.
- **OTS calendars do not backdate.** Required only if anchoring is used.
- **The agent's key is protected in its operational environment.** A leaked agent key allows anyone to act within the delegation's scope up to expiry — hence bond, short expiry, and revocation-on-compromise as the three risk controls.

### 12.4 Bond semantics

The bond is **not escrow**. OC Agent does not enforce slashing on-chain; the sats remain in the principal's wallet and remain spendable. What the bond binds is the OrangeCheck attestation: publicly auditable "the principal declared N sats bonded × M days unspent at the moment of delegation." If the agent misbehaves, the principal's public reputation is on the hook — the same reputational mechanism that makes OrangeCheck itself load-bearing. A verifier that requires a bond is requiring a principal who is willing to make their behavior publicly scored.

This is the same trust architecture as the rest of the OrangeCheck stack: **reputation is a function of staked sats over time, made publicly verifiable by Bitcoin-address-bound signatures.** OC Agent inherits that architecture and applies it to delegation.

## 13. Versioning

`envelope.v` is an integer. Future incompatible changes increment it; minor additions are handled by unknown-field tolerance (§6.3).

## 14. Compliance checklist

A client is OC Agent v1 compliant if and only if:

- [ ] Produces canonical messages byte-for-byte per §4.1, §5.1, §9.1 for identical inputs
- [ ] Computes and verifies `id = H(canonical_message)` for all three envelope kinds
- [ ] Produces envelopes with all required fields per §4.3, §5.3, §9.2
- [ ] Signs hex form of `id` via BIP-322
- [ ] Canonicalizes envelopes per §6 (RFC 8785 + scope-sorting)
- [ ] Parses scope grammar per §7.1 and rejects unknown product/verb in strict mode per §7.3
- [ ] Computes the sub-scope relation per §7.4 for verification
- [ ] Implements all verification steps §8.1–8.3; MAY implement §8.4
- [ ] Publishes delegations to Nostr kind-30083 and revocations to kind-30085 per §10
- [ ] Produces error codes per §11
- [ ] Rejects unknown `v`; preserves unknown fields on relay
- [ ] Passes every committed test vector in [`test-vectors/`](./test-vectors/)

## 15. Registry for extensions

| Field | Current values | Reserved for |
|---|---|---|
| `principal.alg`, `agent.alg`, `sig.alg` | `bip322` | Future: `bip340-schnorr-direct`, `pq-hybrid` |
| `kind` | `agent-delegation`, `agent-action`, `agent-revocation` | Future: `agent-renewal`, `agent-subdelegation` |
| scope `product` | `lock`, `stamp`, `vote`, `nostr`, `http`, `ln`, `mcp` | Any string matching `lowercase-ident`; spec PR required |
| scope `verb` | Per §7.3 | Allocated alongside `product` |
| constraint `key` | Per §7.6 | Spec PR required |

## 16. IANA / external identifiers

- Nostr event kinds: **30083** (delegation, addressable), **30085** (revocation, addressable). Kind 30084 is shared with OC Stamp for action transport, disambiguated by envelope `kind`.
- File extensions: `.delegation`, `.action` (interchangeable with OC Stamp's `.stamp`), `.revocation`.
- MIME types: `application/vnd.oc-agent.delegation+json`, `application/vnd.oc-agent.action+json` (a strict profile of `application/vnd.oc-stamp+json`), `application/vnd.oc-agent.revocation+json`. Self-allocated; not IANA-registered.

## 17. Future work (non-normative)

v1 explicitly does NOT solve:

- **Sub-delegation.** Agent-A delegates a narrower scope to Agent-B. Expressible as a new envelope kind (`agent-subdelegation`) that references an upstream `delegation_id` whose agent matches the sub-delegation's principal. Deferred.
- **Bond slashing.** On-chain escrow of the bond that pays out to a dispute-resolution contract. Out of scope for v1; belongs in a higher-layer protocol.
- **Privacy-preserving scope.** A delegation whose granted scope is only legible to the agent and principal. Doable with OC Lock wrapping the delegation envelope, at the cost of disabling public verification. Deferred.
- **Multi-principal delegations.** Two or more principals jointly grant a single delegation (m-of-n). Expressible as multiple `sig` entries; deferred until a concrete use case.
- **Attestation-bound per-action bond increments.** Binding a bond delta to each action rather than to the delegation root. Interesting for high-stakes agents but not in v1.
- **Post-quantum authenticity.** A v2 would add an SLH-DSA or ML-DSA signature alongside BIP-322.

## 18. Acknowledgements

OC Agent is the fifth primitive in the OrangeCheck stack — identity, confidentiality, legitimacy, provenance, authority — and it composes with every sibling product:

- [**OrangeCheck**](https://ochk.io) provides the principal's bond (sats × days) and the attestation-id discipline referenced in §4.3.
- [**OC Lock**](https://github.com/orangecheck/oc-lock-protocol) is the canonical transport when delegation instructions or action payloads need confidentiality (§12.2).
- [**OC Stamp**](https://github.com/orangecheck/oc-stamp-protocol) is the base of the agent-action envelope; every stamp verifier reads an agent-action as a stamp with extension fields, and every OC Agent implementation depends on `@orangecheck/stamp-core` for the underlying crypto.
- [**OC Vote**](https://github.com/orangecheck/oc-vote-protocol) provides a registered `vote:cast` scope so delegations may grant voting authority on specific polls.
- [**OpenTimestamps**](https://opentimestamps.org) anchors agent-actions and revocations when priority matters. We do not rebuild it; we compose with it, crediting **Peter Todd** and the OTS contributors.

---

End of specification.
