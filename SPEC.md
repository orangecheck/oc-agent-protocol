# OC Agent Protocol v1.0 — Specification

**Status:** Stable
**Date:** 2026-04
**Related:** [OrangeCheck](https://ochk.io/docs/spec) (identity + stake), [OC Lock v2](https://github.com/orangecheck/oc-lock-protocol) (private envelopes), [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol) (content attestation + OTS anchoring), [OC Vote v1](https://github.com/orangecheck/oc-vote-protocol) (legitimate polls)
**v1.1 add-on:** [`SUB-DELEGATION.md`](./SUB-DELEGATION.md) (chained authority)
**v1.2 add-ons:** [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md) (confidential scope lists), [`FEDERATION.md`](./FEDERATION.md) (federation/multisig principal — **normative**)

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

OC Agent defines three v1.0 envelope types and two additive extensions (v1.1 sub-delegation, v1.2 private-scope). All share the canonical-message / BIP-322 / Nostr publication discipline of the rest of the OrangeCheck stack.

| Envelope | `kind` | Nostr kind | Purpose |
|---|---|---|---|
| **Delegation** | `agent-delegation` | 30083 | Principal grants an agent authority over a scoped action set, bounded by expiry and optional stake. v1.2 adds an optional confidential mode where the scope list is sealed via OC Lock — see [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md). |
| **Agent-action** | `agent-action` | 30084 | Agent executes an action within a granted delegation; produces a stamped envelope that cites the delegation. Reuses [OC Stamp v1](https://github.com/orangecheck/oc-stamp-protocol) envelope **structure** (canonical message shape, BIP-322 sig, OTS anchor field) on a separate Nostr kind. |
| **Revocation** | `agent-revocation` | 30085 | Principal (or delegated revocation holder) burns a delegation ahead of its natural expiry. |
| **Sub-delegation** _(v1.1)_ | `agent-subdelegation` | 30086 | An agent grants a *narrower* slice of its authority to another agent. Strictly narrowing in scope and time. See [`SUB-DELEGATION.md`](./SUB-DELEGATION.md) for the normative extension. Sub-delegations MAY also use private-scope mode. |

Within the OrangeCheck family's 30078–30099 range (30078 = OrangeCheck attestation / OC Lock device record, 30080–30082 = OC Vote):

- Kind **30083** is **co-claimed** with [OC Stamp](https://github.com/orangecheck/oc-stamp-protocol). OC Agent uses the `d`-tag namespace `oc-agent-del:<id>` for delegations; OC Stamp uses `oc-stamp:<id>` for stamp envelopes. The two are disjoint and the envelope's internal `kind` field (`agent-delegation` vs `stamp`) is a second disambiguator. **Relay tag filters are exact-match, not prefix** — NIP-01 defines no prefix operator — so a verifier cannot ask a relay for "kind 30083 where `d` starts with `oc-agent-del:`". Disambiguate client-side instead: query by an indexed dimension you already know (`#t` with a principal or agent address, or `#d` with a full `oc-agent-del:<id>` when you have the id), then discard any event whose `content.kind` is not `agent-delegation`. Note also that these kinds sit in a generic NIP-78 addressable range that unrelated applications do use in practice, which is exactly why the `d`-tag namespace and the content-`kind` check are both required rather than optional.

  > **Errata (2026-09-02).** This bullet previously read "Verifiers MUST filter by `#d` prefix when querying kind 30083 alone", which is not an operation NIP-01 provides.
- Kind **30084** is claimed by this spec for agent-action envelopes. Agent-actions reuse OC Stamp v1's envelope **structure** (canonical-message discipline, BIP-322 signature, OTS anchor field), but on a distinct Nostr kind. OC Stamp v1 publishes stamps on kind 30083, not 30084.
- Kind **30085** is claimed exclusively by this spec for revocations (`d`-tag prefix `oc-agent-rev:<id>`).
- Kind **30086** is claimed exclusively by this spec's v1.1 extension for sub-delegations (`d`-tag prefix `oc-agent-sub:<id>`); see [`SUB-DELEGATION.md`](./SUB-DELEGATION.md).

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
| `scopes` | Non-empty array of scope strings. Each MUST be valid per §7. Serialized in sort order for the canonical message. **v1.2:** in private-scope mode this field is replaced by `scopes_encrypted` (mutually exclusive); see [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md) §1.1. |
| `bond.sats` | MUST match `bond_sats` in the canonical message. Non-negative integer. |
| `bond.attestation_id` | Required if `bond` is non-null. MUST be the sha256 of an OrangeCheck canonical message signed by `principal.address`. |
| `issued_at`, `expires_at` | MUST match the canonical message. `expires_at > issued_at`. `expires_at - issued_at ≤ 365 days` (31,536,000 seconds). Verifiers check both at §8.1 step 2. |
| `nonce` | 32 hex chars, uniformly random. Prevents replay of identical-content delegations. |
| `revocation.holders` | Array of `"principal"` and/or `"agent"`. Default `["principal"]`. Informational: it is not part of the canonical message (§4.1), so it decides nothing. The principal and the agent may always revoke (§9.5). |
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
2. Values are kept exactly as written. Canonicalization never changes their case, and §7.4 compares them byte for byte. A value whose type ignores case has one spelling, lower case (rule 4), so equal values are equal bytes.
3. Redundant whitespace is removed (there should be none after lexing).
4. The values of these keys have one spelling, in ASCII:
   - an integer key (`kind` and the `max_*` keys of §7.6): a decimal integer, ASCII digits optionally led by `-`, within ±(2^53 − 1);
   - `method`: an RFC 9110 token (ASCII `tchar`) with no lower-case letter. HTTP methods are case-sensitive, and the registered ones are upper case (RFC 9110 §9.1);
   - a hex key (`node`, `poll_id`, `content_hash_prefix`): lower-case hex digits only;
   - `mime`: a type and subtype of RFC 6838 restricted names, in lower case, with no parameters;
   - an address (`recipient`, `counterparty`) whose prefix is `bc1`, `tb1` or `bcrt1` in any case: bech32 or bech32m in lower case, its canonical form (BIP-173 refuses mixed case). A base58 address is case-sensitive and kept as written;
   - a URL (`origin`, `server`, `relay`): no backslash, and no upper-case letter in its scheme and authority (host, port and any user information) or, without `//`, before its first `/`, `?` or `#`. The path, query and fragment keep their case.

   A scope with any other value for one of these keys is malformed (`E_BAD_SCOPE_GRAMMAR`), whether it is granted or exercised, in strict and permissive mode alike. A verifier applies these rules to the keys registered for the scope's product and verb; §7.4's `!=` applies them to every key with these names, so a value they refuse never meets or grants `!=`. The value is still kept as written (rule 2).
5. A registered prefix key names a prefix and means "starts with". The only one is `content_hash_prefix` of `stamp:sign`; a key is a prefix key by registration, never by its name. It is written with `=`; `!=` on it is malformed (`E_BAD_SCOPE_GRAMMAR`), granted or exercised, in either mode.

The canonical form is the exact byte sequence recorded in `scopes` / `scope_exercised`.

### 7.3 Registered MVP scopes

Implementations MUST accept these products and verbs. A scope with an unknown product or verb is **rejected** by conservative verifiers (ok to treat as "no authority granted") and MAY be accepted by permissive verifiers that know about extensions.

| Scope | Semantics | Example scope string |
|---|---|---|
| `lock:seal` | Encrypt and send an OC Lock envelope to a recipient. | `lock:seal(recipient=bc1qalice…, mime=text/plain, max_bytes<=65536)` |
| `lock:chat` | Send an OC Lock chat message over Nostr. | `lock:chat(recipient=bc1qbob…, max_msgs<=100, max_bytes_per_msg<=4096)` |
| `stamp:sign` | Produce an OC Stamp envelope over content. | `stamp:sign(mime=application/pdf, max_bytes<=1048576)` |
| `vote:cast` | Cast a vote in an OC Vote poll. | `vote:cast(poll_id=abc123…, choice=yes)` |
| `nostr:publish` | Publish a Nostr event under the agent's Nostr key. | `nostr:publish(kind=1, max_bytes<=1024)` |
| `http:request` | Issue an HTTP request to a target origin. | `http:request(origin=https://api.example.com, method=GET, max_rps<=10)` |
| `ln:send` | Initiate a Lightning payment. | `ln:send(max_sats<=1000, max_fee_sats<=10)` |
| `mcp:invoke` | Invoke an MCP tool. | `mcp:invoke(server=https://mcp.example.com, tool=search, max_invocations<=50)` |
| `pledge:create` | Sign an OC Pledge envelope on the principal's behalf (oc-pledge-protocol SPEC §7.3). | `pledge:create(max_bond_sats<=2000000, mechanism=vote_resolves)` |
| `anthropic:tool` | Run a tool for an Anthropic `tool_use` block (`@orangecheck/agent-anthropic`). | `anthropic:tool(name=invoice.create)` |
| `openai:function` | Run a function for an OpenAI function or tool call (`@orangecheck/agent-openai`). | `openai:function(name=invoice.create)` |
| `vercel:tool` | Run a Vercel AI SDK tool (`@orangecheck/agent-vercel`). | `vercel:tool(verb=invoice.create)` |
| `langgraph:tool` | Run a LangGraph tool node (`@orangecheck/agent-langgraph`). | `langgraph:tool(verb=invoice.create)` |

Constraints in the `Example scope string` column are illustrative — registered keys per scope are normative in §7.6 and the canonical form rules are §7.2. A delegation MAY grant a scope with no constraints (`lock:seal`), which is maximally permissive for that verb and which verifiers MAY reject by policy unless bonded.

### 7.4 Sub-scope relation

A scope `S_exercised` is a **sub-scope** of delegated scope `S_granted` iff:

1. `product` and `verb` are identical.
2. For every constraint `(k, op, v)` in `S_granted`:
   - If `op = "*"` in `S_granted`: no requirement on `S_exercised` for key `k`.
   - If `op = "="` in `S_granted`: `S_exercised` MUST contain `(k, "=", v)` exactly. For a registered prefix key (§7.2 rule 5) it MUST contain `(k, "=", v')` where `v'` starts with `v`.
   - If `op = "!="` in `S_granted`: `S_exercised` MUST contain `(k, "=", v')` where `v' != v`, or `(k, "!=", v)`. Values of an integer key compare as integers, so `kind=00` does not meet `kind!=0` and `kind!=00` restates it. Other values compare byte for byte (§7.2 rule 2), so a value with two spellings of the same thing, such as a URL with and without its default port, meets `!=` in its other spelling: grant such keys with `=`.
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
| `lock:seal` | `recipient`, `mime`, `max_bytes` | bare-token (btc address: bech32 in lower case, base58 as written), mime (type/subtype, lower case), integer |
| `lock:chat` | `recipient`, `max_bytes_per_msg`, `max_msgs` | bare-token (btc address, as `lock:seal`), integer, integer |
| `stamp:sign` | `mime`, `max_bytes`, `content_hash_prefix` | mime (type/subtype, lower case), integer, hex-prefix (lower case) |
| `vote:cast` | `poll_id`, `choice` | hex (lower case), bare-token |
| `nostr:publish` | `kind`, `relay`, `max_bytes` | integer, url (scheme and authority in lower case), integer |
| `http:request` | `origin`, `method`, `max_rps`, `max_bytes_out` | url (scheme and authority in lower case), HTTP method (ASCII token, no lower case, §7.2 rule 4), integer, integer |
| `ln:send` | `max_sats`, `node`, `max_fee_sats` | integer, hex pubkey (lower case), integer |
| `mcp:invoke` | `server`, `tool`, `max_invocations` | url (scheme and authority in lower case), bare-token, integer |
| `pledge:create` | `max_bond_sats`, `mechanism`, `counterparty` | integer, bare-token, bare-token (btc address, as `lock:seal`) |
| `anthropic:tool` | `name` | bare-token, case-sensitive (a tool name) |
| `openai:function` | `name` | bare-token, case-sensitive (a tool name) |
| `vercel:tool` | `verb` | bare-token, case-sensitive (a tool name) |
| `langgraph:tool` | `verb` | bare-token, case-sensitive (a tool name) |

`max_*` keys are upper-bound constraints; use with ordered ops (`<`, `<=`).

A verifier encountering an **unregistered constraint key** for a registered product/verb:

- In **strict mode:** rejects the envelope.
- In **permissive mode:** accepts the envelope, and the key still binds. §7.4 applies to every constraint of a granted scope, registered or not, so an exercised scope must meet it (vector v49). A verifier never drops a granted constraint it does not know, because the grant without it is wider than what the principal signed.

Clients SHOULD default to strict mode. OC Pledge refuses a `pledge:create` key, operator or value it does not recognise in either mode (oc-pledge-protocol SPEC §7.3).

A key that describes a product envelope's content, and not the action's own fields (§8.3 step 12a), is checked by the product's verifier, which reads its value from that envelope and never from `A.scope_exercised`. Each product specification states that duty: `vote:cast` in oc-vote-protocol SPEC §10 item 9, `lock:seal` in oc-lock-protocol SPEC §7.5, `lock:chat` there and in oc-chat-protocol SPEC §12, and `pledge:create` in oc-pledge-protocol SPEC §7.3 step 4.

## 8. Verification algorithm

A **full verification** of an agent-action envelope `A` against its cited delegation envelope `D` produces one of:

- `OK { id, agent, principal, scope, content, signed_at, anchor, bond }` — all checks passed.
- An `AgentError`-style code (see §11).

It takes one of two forms. **Live verification** decides whether to act on `A`
now. It is evaluated at the time of verification, written `now`, and it is
what every step below means unless the step says otherwise. An **audit**
(§8.6) checks a past action as of its own `A.signed_at`. A verifier deciding
whether to act on `A` MUST use live verification.

### 8.1 Verify the delegation

Given `D`:

1. **Version check.** If `D.v !== 1` → `E_UNSUPPORTED_VERSION`.
2. **Shape check.** All required fields (§4.3) present and typed correctly, `expires_at > issued_at`, and `expires_at - issued_at ≤ 365 days` (§4.4); else `E_MALFORMED`. Unlike step 6, this does not depend on the verification time.
3. **Canonical consistency.** Reconstruct the canonical message from (`D.principal.address`, `D.agent.address`, sorted `D.scopes`, `D.bond?.sats | 0`, `D.bond?.attestation_id | "none"`, `D.issued_at`, `D.expires_at`, `D.nonce`). Compute `id' = H(canonical)`. If `hex(id') !== D.id` → `E_BAD_ID`.
4. **Scope grammar.** Every entry of `D.scopes` MUST parse per §7.1 and lie within the registry per §7.3 / §7.6. Else `E_BAD_SCOPE_GRAMMAR`.
5. **Signature verify.** Verify `D.sig.value` under BIP-322 as a signature by `D.principal.address` over ASCII `D.id`. If invalid → `E_BAD_SIG`.
6. **Temporal check.** If `now < D.issued_at` → `E_NOT_YET_VALID`. If `now >= D.expires_at` → `E_EXPIRED`. Under a sub-delegation chain, every link is checked at `now`.
7. **Revocation check.** Query §9 revocation registries for a valid revocation targeting `D.id` (§9.4). If one is in effect at or before `now` (§9.3), or its effective time precedes `A.signed_at` (§9.3) → `E_REVOKED`. Only relays that answered (§10.4) can show that none exists.

### 8.2 Verify the action (core)

Given `A`:

8. **Base stamp check.** Run OC Stamp §8.1 steps 1–5 against `A`, treating `A` as a stamp envelope. This produces `OK_stamp` or an error; a stamp error is returned with code `E_BAD_ACTION_STAMP`.

### 8.3 Verify authority

Given authenticated `A` and `D`:

9. **Delegation binding.** `A.delegation_id` MUST equal `D.id`. Else `E_DELEGATION_MISMATCH`.
10. **Agent binding.** `A.signer.address` MUST equal `D.agent.address`. Else `E_AGENT_MISMATCH`.
11. **Action ≤ delegation lifetime.** `D.issued_at <= A.signed_at < D.expires_at`. Else `E_OUT_OF_WINDOW`.
11a. **Freshness.** `|now − A.signed_at|` MUST NOT exceed the verifier's bound. Else `E_STALE`. The bound is the verifier's to set; 120 seconds is RECOMMENDED. The agent chooses `A.signed_at`, and this bound is what makes it mean "just now".
11b. **Single use.** A verifier that acts on actions MUST NOT act twice on the same `A.id`. It keeps the ids it accepted at least until `A.signed_at` plus its bound; after that, step 11a refuses them.
12. **Scope check.** `A.scope_exercised` MUST parse per §7.1 and MUST be a sub-scope (§7.4) of at least one scope in `D.scopes`. Else `E_SCOPE_DENIED`.
12a. **Content-bound keys.** For each key the table binds to the action's own content, the verifier derives the value from `A.content`, which the signature covers, and never reads the agent's claim for it. It replaces those constraints of `A.scope_exercised` with `(k, "=", derived value)`, adding any the claim leaves out; the result MUST be a sub-scope of a scope in `D.scopes` that admits `A.scope_exercised`. Else `E_SCOPE_DENIED`. A signer MUST NOT sign an action whose derived values fall outside its own `scope_exercised`.

| Scope | Key | Derived from the signed action |
|---|---|---|
| `stamp:sign` | `mime` | `A.content.mime`: its type/subtype, in lower case |
| `stamp:sign` | `max_bytes` | `A.content.length` |
| `stamp:sign` | `content_hash_prefix` | the hex of `A.content.hash` |

No other registered scope has a key that `A`'s signed fields describe. Their content is a product envelope (an OC Lock envelope, a ballot, a Nostr event, an MCP invocation), and its recipient, poll, kind or tool is in the content bytes, which `A` commits to only by hash. A verifier that holds those bytes reads such values from them, as the product's own specification defines; for `mcp:invoke`, `@orangecheck/agent-mcp` binds the invocation through the content check of §8.1.

### 8.4 Verify bond (optional)

If caller policy requires a bond:

13. **Bond presence.** If `D.bond === null` → `E_NO_BOND`.
14. **Bond threshold.** `D.bond.sats >= caller_threshold_sats`. Else `E_BOND_UNMET`.
15. **Attestation re-resolution.** Resolve `D.bond.attestation_id` via `@orangecheck/sdk#verify` and confirm declared `sats_bonded` and `days_unspent` are still true (or still exceed the caller's policy). Else `E_BOND_UNVERIFIED`.

### 8.5 What full verification guarantees

| Check clean | Guarantee |
|---|---|
| `E_BAD_SIG` on D | Holder of `D.principal.address` at `issued_at` authorized this delegation. |
| `E_REVOKED` absent | No revocation is in effect at the time of verification, and none predates the action's signed-at (modulo OTS anchoring, §9.3). |
| `E_STALE` absent | The action was signed within the verifier's bound of the time of verification. |
| `E_BAD_ACTION_STAMP` clean | Holder of `D.agent.address` at `A.signed_at` authorized this action. |
| `E_SCOPE_DENIED` absent | The exercised scope is a legal narrowing of a granted scope. |
| `E_BOND_UNVERIFIED` absent | The principal's declared bond is currently still staked. |

Verification is entirely local: envelope + Nostr relay transcripts + Bitcoin headers. **No ochk.io endpoint is required or consulted at verify time.**

### 8.6 Auditing a past action

An audit checks a past action as of its own `A.signed_at`, for example to read
a log of actions. It runs §8.1–8.3 with these changes:

- Step 6 is not run. Step 11 places `A.signed_at` inside the delegation's window.
- Step 7 refuses only a revocation whose effective time precedes `A.signed_at` (§9.3).
- Steps 11a and 11b are not run.

`A.signed_at` is the agent's own claim unless the action carries an OTS anchor
the verifier has checked (§9.3). An audit result MUST say which, and MUST NOT be
used to decide whether to act on `A` now.

## 9. Revocation

A principal may burn a delegation before its expiry by publishing an `agent-revocation` envelope.

### 9.1 Canonical message (signed by the principal or the agent, §9.5)

```
oc-agent:revocation:v1
address: <signer_btc_address>
delegation_id: <64-hex>
reason: <printable ASCII, at most 128 bytes, "" if omitted>
signed_at: <ISO 8601 UTC>
```

Each line LF-terminated; no trailing LF after `signed_at`. The first line is the literal 22-byte string `oc-agent:revocation:v1`.

A signer MUST write the reason as printable ASCII (0x20–0x7E), at most 128 bytes: a line break would add a line to the signed message. The reason grants and withholds nothing, so a verifier MUST NOT read it to decide. A revocation whose signature and revoker check out revokes whatever its reason holds, even one outside ASCII, holding a control character, or longer than 128 bytes (vectors v34–v36). A reason that is absent or `null` is `""` (vector v40). A reason shown to a person has its control, bidi, invisible and line-separating characters escaped, never dropped.

A verifier decides a revocation on its signed bytes only. `v`, `id`, `kind`, `sig.pubkey` and `sig.alg` are copies outside the signature: a verifier MUST NOT refuse or skip a revocation over them. It computes the id from the signed fields, checks the signature against that id and `signer.address`, and MAY flag a stated `id` or a `kind` that differs (vectors v37, v38, v41, v42). A signature that verifies only against the stated id is not a valid revocation. A revocation's anchor (§9.3) is checked against the computed id.

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

An anchor counts for this comparison only when the verifier has checked the
proof: the OTS proof MUST commit the envelope's own `id` and chain to the
Bitcoin block header at the declared height. The `ots` object is outside the
envelope signature, so an anchor that has not been checked MUST be treated as
absent for priority. When the action is verifiably anchored and the revocation
is not, the anchor proves nothing about the revocation's time, and the verifier
compares `signed_at` values.

> **Errata (2026-09-24).** Earlier text did not say that an anchor must be
> verified, or bound to the envelope id, before it is used for priority. No
> wire change; verdicts on every test vector are unchanged.

**Live verification.** A revocation is in effect once its effective time is at
or before the time of verification. From then on a live verifier refuses every
action under the revoked delegation (§8.1 step 7), whatever `signed_at` the
action carries: an unanchored `signed_at` is the agent's claim and cannot place
an action before a revocation already in effect. The comparison above, between
an action and a revocation, is what an audit (§8.6) uses.

### 9.4 Publication

Revocations are published as Nostr **kind-30085** events:

```
event.kind       = 30085
event.tags       = [
  ["d",              "oc-agent-rev:" || revocation_id],
  ["t",              delegation_id],
  ["t",              signer.address],
  ["delegation",     delegation_id],
  ["signer_addr",    signer.address]
]
event.content    = <canonical JSON of revocation envelope>
event.pubkey     = ephemeral_nostr_pubkey
event.created_at = unix_seconds
```

The two `t` tags are **normative and load-bearing**. Relays are only required
to index **single-letter** tag names (NIP-12), so a filter on a multi-letter
name such as `#delegation` matches nothing on a conforming relay. The
`delegation` and `signer_addr` tags are retained for human readability and for
the minority of relays that index multi-letter names; a verifier MUST NOT
depend on them.

A revocation crawl query — "has this delegation been revoked?":

```
REQ { "kinds": [30085], "#t": ["<delegation_id 64-hex>"] }
```

Because `t` carries both the delegation id and the signer address, a matched
event MUST be confirmed against its content: treat it as revoking a delegation
only if `content.delegation_id` equals the id you queried for. A relay that
did not answer this query (§10.4) is not evidence that no revocation exists.

> **Errata (2026-09-02).** Versions of this section before this date specified
> only the multi-letter tags and prescribed
> `REQ { "kinds": [30085], "#delegation": [...] }`. That query cannot match on
> a NIP-12 relay, so a conforming implementation would find no revocations and
> honour a revoked delegation — the worst available failure direction. The
> reference client implemented the spec faithfully and inherited the bug. No
> migration is required: a relay sweep on 2026-09-02 found zero kind-3008x
> events carrying an `oc-agent-` `d`-tag prefix, so no published revocation
> predates the fix.

Clients SHOULD publish to the same diverse relay set they used for the delegation (§10.1).

### 9.5 Authorized revokers

Two addresses may sign a revocation of a delegation: its `principal.address`
and its `agent.address`. A verifier MUST honour a valid revocation signed by
either, whatever the delegation's `revocation.holders` says, including when it
is absent, empty, or omits either. A revocation signed by any other address →
`E_REVOKER_UNAUTHORIZED`.

`revocation.holders` is outside the principal's signature, so two copies of one
delegation id can carry different `holders`, and a verifier cannot tell which
the principal wrote. Revoking only removes authority, so the agent's revocation
stands on every copy. `holders` is informational.

> **Errata (2026-09-24).** Earlier text derived the authorised set from
> `holders` alone. Because `holders` is not signed, the set a verifier computed
> could differ between two copies of the same delegation id. The principal is
> now always included. No wire change; verdicts on every test vector are
> unchanged.

> **Errata (1.8.0, 2026-10-22).** The agent is always an authorised revoker as
> well. `holders` no longer decides anything. No wire change. Vector v08's
> verdict changes: its revoker is now a third party, and v33 is an agent's
> revocation of a delegation whose `holders` is `["principal"]`, which
> verifies.

## 10. Nostr directory

For durable public discovery, delegations are published to Nostr as **kind-30083** events. This is optional — a delegation envelope is self-contained and travels over any transport.

### 10.1 Delegation event

```
event.kind       = 30083
event.tags       = [
  ["d",              "oc-agent-del:" || delegation_id],
  ["t",              principal.address],
  ["t",              agent.address],
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

A publisher MUST include both `t` tags, each carrying the address exactly as it
appears in the envelope. With `d`, they are the only tags on this event a relay
indexes (§10.4). The `principal`, `agent`, `expires` and `scope` tags are
retained for human readability; a verifier MUST NOT depend on them, and MUST
NOT filter on them (§10.4).

Tags belong to the Nostr event, not to the envelope. They are outside the
canonical message (§4.1) and the envelope id (§4.2), so adding or omitting a
tag never changes an artifact or its id. The same holds for every event in
§9.4, §10.3 and `SUB-DELEGATION.md` §4.1.

The Nostr `pubkey` has no relationship to the Bitcoin identity — authenticity is proven by BIP-322 inside the envelope, not by the Nostr author. A fresh ephemeral Nostr keypair SHOULD be derived per publish:

```
nostr_sk := HKDF(ikm=random(32), salt="oc-agent/v1/nostr-key", info=delegation_id, L=32)
```

Clients SHOULD publish to at least three relays from a diverse set. Reference relays: `relay.ochk.io`, `nos.lol`, `relay.damus.io`, `relay.primal.net`, `nostr.oxtr.dev`.

`relay.ochk.io` is operated by OrangeCheck and is named here per the family's "trust anchors are named, not hidden" rule. It carries no special authority: a relay is a directory, and every artifact in this spec is verifiable offline from its own bytes plus public chain data, so nothing about correctness depends on which relay served it.

> **Co-claim with OC Stamp.** Kind 30083 also carries OC Stamp envelopes. The two sub-protocols are distinguishable after fetching in three ways: (1) `d`-tag prefix — `oc-agent-del:<id>` vs `oc-stamp:<id>`; (2) `event.tags` shape — agent-delegation events tag `principal` and `agent`, stamp events tag `t` with `oc-stamp`; (3) `event.content` envelope `kind` field — `agent-delegation` vs `stamp`. A relay cannot do this separation for you: tag filters match whole values, so `#d` finds one event by its full `d` value and never a prefix. Query by `#t` or by a full `#d` (§10.2), then discard any event whose envelope `kind` is not `agent-delegation`.

### 10.2 Discovery queries

By principal or by agent — one query serves both, because `t` carries both
addresses:
```
REQ { "kinds": [30083], "#t": ["bc1q…"] }
```

The matches include delegations where the address is the other party, and OC
Stamp envelopes signed by that address (OC Stamp co-claims kind 30083 and tags
`t` with the signer). Keep an event only if `content.kind` is
`agent-delegation` and `content.principal.address` (by principal) or
`content.agent.address` (by agent) equals the queried address.

By delegation id:
```
REQ { "kinds": [30083], "#d": ["oc-agent-del:<id>"] }
```

By scope product: query by agent as above, then keep the delegations whose
`content.scopes` include a scope of that product. The `scope` tags are not
indexed, and in private mode (`PRIVATE-SCOPE.md`) they may be absent.

Everything that cites a delegation id — its actions (§10.3), its revocations
(§9.4) and its sub-delegations (`SUB-DELEGATION.md` §4.2) — carries that id as
a `t` tag in the same form, 64 lowercase hex characters with no prefix. One
filter asks for all three:
```
REQ { "kinds": [30084, 30085, 30086], "#t": ["<delegation id>"] }
```

Route each match on `content.kind` and confirm it against its content as each
section says. The `t` tags on actions and sub-delegations are SHOULD, not MUST,
so this finds only the events whose publisher set them.

> **Errata (2026-10-20).** Earlier text prescribed `"#principal"` and
> `"#agent"` filters. Relays reject a filter on a multi-letter tag name (§10.4),
> so those queries never returned a delegation. Earlier text also omitted the
> two `t` tags from §10.1, although §3 already directed verifiers to query
> `#t` and the reference publisher has emitted both since 2026-04-28.

### 10.3 Agent-action directory

Agent-actions are published to Nostr **kind-30084**, claimed by this spec. The envelope reuses OC Stamp v1's structural shape (canonical message, BIP-322 sig, OTS anchor field) but lives on a distinct Nostr kind from stamps (which use 30083). Find an action by its id:

```
REQ { "kinds": [30084], "#d": ["oc-agent-act:<action id>"] }
```

Find the actions under a delegation by its id:

```
REQ { "kinds": [30084], "#t": ["<delegation id>"] }
```

Keep an event only if `content.kind` is `agent-action` and
`content.delegation_id` equals the id you queried for. An action under a
sub-delegation cites the sub-delegation's id, not the root's; to list a whole
chain's actions, find its sub-delegations first (`SUB-DELEGATION.md` §4.2) and
query with every id.

This query finds only actions published with the `t` tag below, which
publishers SHOULD include and earlier publishers did not. An answer with no
events (§10.4) means no tagged action on that relay, never that the agent took
no action under the delegation. A verifier MUST NOT rely on this listing being
complete; it obtains the actions it must judge from the agent or from whoever
presents them.

The internal `kind: "agent-action"` field on the envelope is the authoritative discriminator if a non-conformant publisher ever puts a non-action event under kind 30084.

The event's tags:

```
event.tags = [
  ["d",          "oc-agent-act:" || action_id],
  ["t",          delegation_id],
  ["kind",       "agent-action"],
  ["delegation", delegation_id],
  ["agent",      signer.address],
  ["scope",      scope_exercised],
  ["hash",       content.hash],
  ["signed_at",  signed_at]
]
```

The `d` tag is `oc-agent-act:<id>`. Publishers SHOULD include the `t` tag,
carrying `delegation_id` as 64 lowercase hex characters, the form §9.4 uses
for revocations. The remaining tags are readable hints; a verifier MUST NOT
depend on them, and MUST NOT filter on them (§10.4). Like every tag, the `t`
tag is outside the envelope's canonical message and id (§10.1).

> **Errata (2026-10-20, 1.4.1).** Earlier text prescribed
> `REQ { "kinds": [30084], "#delegation": [...] }`. Relays reject that filter
> (§10.4), so it never returned an action.
>
> **Addition (2026-10-20, 1.5.0).** The `t` tag carrying the delegation id is
> new. Without it no relay query could list a delegation's actions. Actions
> published without it remain valid and are found by id.

### 10.4 Reading relay replies

Relays index only single-letter tag names (NIP-01). The filters in §9.4,
§10.2, §10.3 and `SUB-DELEGATION.md` §4.2 use only `#d` and `#t`. A client
MUST NOT filter on a multi-letter tag name (`#principal`, `#agent`,
`#delegation`, `#parent`, `#root`). Such a filter does not fail quietly. Most relays reject the whole REQ, including any other filter in it,
with a `CLOSED` or a `NOTICE` carrying `unindexed tag filter`. At least one
relay ignores the filter and returns unrelated events of the requested kind.

A relay has **answered** a query only when it sent `EOSE` for that
subscription and every event it returned satisfies the filter as sent. Any
other outcome means the client has **not heard back** from that relay:

- a `CLOSED` for the subscription, or a `NOTICE` reporting an error;
- the connection failing or closing before `EOSE`;
- no `EOSE` before the client's deadline;
- an event that does not satisfy the filter, which shows the relay did not
  apply it.

Not hearing back MUST NOT be treated as evidence that no matching event
exists. In particular, a verifier MAY conclude that a delegation has no
revocation (§8.1 step 7) only from relays that answered. If no relay
answered, the revocation check has not been performed. The verifier MUST then
either fail or report the result as unchecked for revocation; it MUST NOT
report the delegation as unrevoked. An event a relay returns is a candidate,
never a verdict. Confirm it against its content (§9.4, §10.2, §10.3) and
verify its envelope before acting on it.

A relay that answered with no events has no matching event that carries the
tag. Where a tag is SHOULD rather than MUST (§10.3, `SUB-DELEGATION.md` §4.1),
that is not evidence that no such artifact exists.

> **Errata (2026-10-20).** This section is new. Earlier text prescribed filters
> that relays reject (§10.2, §10.3, `SUB-DELEGATION.md` §4.2, and the
> revocation query in `SECURITY.md` §5 item 7) and did not say how to read a
> rejection. Read as "no events", a rejected revocation query honours a revoked
> delegation.

## 11. Errors

Client errors MUST use these codes.

| Code | Meaning |
|---|---|
| `E_UNSUPPORTED_VERSION` | Envelope `v` is unknown. |
| `E_MALFORMED` | Envelope shape / field types / required fields invalid, or a delegation window that breaks §4.4. |
| `E_BAD_ID` | Reconstructed canonical message does not hash to declared `id`. Not raised for a revocation, whose stated `id` is a copy (§9.1). |
| `E_BAD_SIG` | BIP-322 signature did not verify. |
| `E_BAD_SCOPE_GRAMMAR` | A scope string failed §7.1 / §7.3 / §7.6 parsing. |
| `E_NOT_YET_VALID` | Action or delegation is referenced before `issued_at`. |
| `E_EXPIRED` | Delegation is past `expires_at` at the verification / action time. |
| `E_REVOKED` | A valid revocation is in effect at the time of verification, or predates the action per §9.3. |
| `E_STALE` _(1.7.0)_ | Live verification: `A.signed_at` lies further from the time of verification than the verifier's bound (§8.3 step 11a). |
| `E_DELEGATION_MISMATCH` | `A.delegation_id` does not equal `D.id`. |
| `E_AGENT_MISMATCH` | `A.signer.address` does not equal `D.agent.address`. |
| `E_OUT_OF_WINDOW` | `A.signed_at` falls outside `[D.issued_at, D.expires_at)`. |
| `E_SCOPE_DENIED` | `A.scope_exercised` is not a sub-scope of any granted scope. |
| `E_BAD_ACTION_STAMP` | Underlying OC Stamp verification failed on the agent-action. |
| `E_NO_BOND` | Caller policy required a bond; delegation has none. |
| `E_BOND_UNMET` | Declared bond sats below caller threshold. |
| `E_BOND_UNVERIFIED` | OrangeCheck attestation no longer satisfies the declared bond. |
| `E_REVOKER_UNAUTHORIZED` | Revocation signer is neither the delegation's principal nor its agent (§9.5). |
| `E_CALENDAR_UNREACHABLE` | Anchor upgrade required a calendar fetch that failed. |
| `E_SUBDELEGATION_DEPTH_EXCEEDED` _(v1.1)_ | Chain depth exceeds verifier's configured maximum. See [`SUB-DELEGATION.md`](./SUB-DELEGATION.md) §2.1. |
| `E_SUBDELEGATION_PRINCIPAL_MISMATCH` _(v1.1)_ | A subdelegation's `parent_id` or `principal.address` does not match the parent envelope. See `SUB-DELEGATION.md` §2.2 step 3e. |
| `E_SUBDELEGATION_EXPIRES_EXTENDED` _(v1.1)_ | A subdelegation's window is not contained within its parent's. See `SUB-DELEGATION.md` §2.2 step 3f. |
| `E_SUBDELEGATION_SCOPE_ESCALATED` _(v1.1)_ | A subdelegation grants a scope that is not a sub-scope of any scope in its parent. See `SUB-DELEGATION.md` §2.2 step 3g. |
| `E_SCOPES_BOTH_PROVIDED` _(v1.2)_ | Envelope carries both `scopes` and `scopes_encrypted`. Pick one. See [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md) §2 step P1. |
| `E_SCOPES_NEITHER_PROVIDED` _(v1.2)_ | Envelope carries neither `scopes` nor `scopes_encrypted`. See `PRIVATE-SCOPE.md` §2 step P2. |
| `E_SCOPES_UNREADABLE` _(v1.2)_ | Verifier cannot decrypt `scopes_encrypted` — no held key matches any recipient. See `PRIVATE-SCOPE.md` §2 step P5. |
| `E_BAD_LOCK_ENVELOPE` _(v1.2)_ | The embedded OC Lock envelope failed its own verification (signature, canonical, expiry). See `PRIVATE-SCOPE.md` §2 step P4 and OC Lock SPEC §8. |

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
- **When an unanchored action was signed.** `A.signed_at` is the agent's own statement. Live verification bounds it by the verifier's clock (§8.3 step 11a); an audit can only report it (§8.6), unless an OTS anchor fixes it.
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
- [ ] Reads integer and method values per §7.2 rule 4, and computes the sub-scope relation per §7.4 over every granted constraint, registered or not (§7.6)
- [ ] Implements all verification steps §8.1–8.3; MAY implement §8.4
- [ ] Verifies live at the time of verification, with a freshness bound and single use (§8.1 steps 6–7, §8.3 steps 11a–11b), whenever the result decides whether to act; reports an audit's `A.signed_at` as the agent's claim unless anchored (§8.6)
- [ ] Publishes delegations to Nostr kind-30083 and revocations to kind-30085 per §10
- [ ] Queries relays with `#d` and `#t` filters only, and treats a relay that did not answer as not heard back, per §10.4
- [ ] Produces error codes per §11
- [ ] Rejects unknown `v`; preserves unknown fields on relay
- [ ] Passes every committed test vector in [`test-vectors/`](./test-vectors/)

## 15. Registry for extensions

| Field | Current values | Reserved for |
|---|---|---|
| `principal.alg`, `agent.alg`, `sig.alg` | `bip322` | Future: `bip340-schnorr-direct`, `pq-hybrid` |
| `kind` | `agent-delegation`, `agent-action`, `agent-revocation` | Future: `agent-renewal`, `agent-subdelegation` |
| scope `product` | `lock`, `stamp`, `vote`, `nostr`, `http`, `ln`, `mcp`, `pledge`, `anthropic`, `openai`, `vercel`, `langgraph` | Any string matching `lowercase-ident`; spec PR required |
| scope `verb` | Per §7.3 | Allocated alongside `product` |
| constraint `key` | Per §7.6 | Spec PR required |

## 16. IANA / external identifiers

- Nostr event kinds: **30083** (delegation, addressable, **co-claimed with OC Stamp** — disjoint `d`-tag prefixes `oc-agent-del:` vs `oc-stamp:`), **30084** (agent-action, claimed by this spec — reuses OC Stamp v1's envelope **structure** but on a distinct Nostr kind), **30085** (revocation, addressable, claimed by this spec), **30086** _(v1.1)_ (sub-delegation, addressable, claimed by this spec — see [`SUB-DELEGATION.md`](./SUB-DELEGATION.md)). See §10 for verifier disambiguation rules.
- File extensions: `.delegation`, `.action` (interchangeable with OC Stamp's `.stamp`), `.revocation`, `.subdelegation` _(v1.1)_.
- MIME types: `application/vnd.oc-agent.delegation+json`, `application/vnd.oc-agent.action+json` (a strict profile of `application/vnd.oc-stamp+json`), `application/vnd.oc-agent.revocation+json`, `application/vnd.oc-agent.subdelegation+json` _(v1.1)_. Self-allocated; not IANA-registered.

## 17. Future work (non-normative)

v1.1 ships sub-delegation as an additive extension — see [`SUB-DELEGATION.md`](./SUB-DELEGATION.md). v1.2 ships private-scope as an additive extension that composes with OC Lock — see [`PRIVATE-SCOPE.md`](./PRIVATE-SCOPE.md). The following remain deferred:

- **Bond slashing.** On-chain escrow of the bond that pays out to a dispute-resolution contract. Out of scope for v1; belongs in a higher-layer protocol.
- **Multi-principal delegations.** Two or more principals jointly grant a single delegation (m-of-n). Expressible as multiple `sig` entries; deferred until a concrete use case.
- **Bond layering on sub-delegations.** v1.1 sub-delegations cannot carry their own bond — the root bond backstops the entire chain. A future version may allow per-link bond deltas for high-stakes hand-offs.
- **Attestation-bound per-action bond increments.** Binding a bond delta to each action rather than to the delegation root. Interesting for high-stakes agents but not yet specified.
- **Post-quantum authenticity.** A v2 would add an SLH-DSA or ML-DSA signature alongside BIP-322.
- **Recipient-identity-confidential delegations.** v1.2 leaks recipient addresses in the OC Lock envelope's `recipients[]` field. A future variant could double-wrap to hide recipients themselves.

## 18. Acknowledgements

OC Agent is the fifth primitive in the OrangeCheck stack — identity, confidentiality, legitimacy, provenance, authority — and it composes with every sibling product:

- [**OrangeCheck**](https://ochk.io) provides the principal's bond (sats × days) and the attestation-id discipline referenced in §4.3.
- [**OC Lock**](https://github.com/orangecheck/oc-lock-protocol) is the canonical transport when delegation instructions or action payloads need confidentiality (§12.2).
- [**OC Stamp**](https://github.com/orangecheck/oc-stamp-protocol) is the base of the agent-action envelope; every stamp verifier reads an agent-action as a stamp with extension fields, and every OC Agent implementation depends on `@orangecheck/stamp-core` for the underlying crypto.
- [**OC Vote**](https://github.com/orangecheck/oc-vote-protocol) provides a registered `vote:cast` scope so delegations may grant voting authority on specific polls.
- [**OpenTimestamps**](https://opentimestamps.org) anchors agent-actions and revocations when priority matters. We do not rebuild it; we compose with it, crediting **Peter Todd** and the OTS contributors.

---

End of specification.
