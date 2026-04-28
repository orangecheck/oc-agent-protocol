# Private scope (OC Agent v1.2)

> **Normative companion to [`SPEC.md`](./SPEC.md).** This document specifies an optional, additive way to keep a delegation's `scopes` field confidential against any party who lacks an explicit decryption key. The principal seals the canonical scope list with [OC Lock](https://github.com/orangecheck/oc-lock-protocol), names a set of recipients (the agent and zero or more authorized verifiers), and the published envelope carries the OC Lock envelope in place of the plaintext scope list. v1.0 verifiers see an unfamiliar field, see no `scopes`, fail closed — correct fail-closed behavior. v1.2 verifiers decrypt if they hold one of the recipient device keys, then verify normally.

## 0. The stance

OC Agent v1.0 publishes scopes in plaintext on Nostr kind 30083. That is the right default — public verifiability is a load-bearing property of the family. It is also the wrong default for some real deployments:

- A company's procurement bot exposes its spending caps to competitors.
- An autonomous personal-assistant agent leaks the human's daily activity surface.
- A regulated workflow needs the action surface itself confidential by law or contract.
- A red-team capability constraint reveals the engagement's targets to the targets.

**Privacy-preserving scope is opt-in per delegation.** Public-mode envelopes (no `scopes_encrypted` field) are unchanged from v1.0 — they continue to verify against any v1.0 or v1.2 verifier with byte-identical results. The same agent address can hold both private-scope and public-scope delegations simultaneously. The choice is the principal's, made at issuance time.

## 1. Wire format

A v1.2 delegation envelope EITHER carries `scopes` (v1.0 public mode) OR `scopes_encrypted` (v1.2 private mode). It MUST NOT carry both, and it MUST NOT omit both.

### 1.1 Envelope schema additions

```json
{
    "v": 1,
    "kind": "agent-delegation",
    "id": "<64-hex>",

    "principal": { "address": "bc1q…", "alg": "bip322" },
    "agent":     { "address": "bc1q…", "alg": "bip322" },

    "scopes_encrypted": <OC Lock v2 envelope>,   // v1.2 private mode

    "bond": { … } | null,
    "issued_at": "…",
    "expires_at": "…",
    "nonce": "<32-hex>",
    "revocation": { "holders": ["principal"] | […], "ref": null },
    "sig": { "alg": "bip322", "pubkey": "<principal.address>", "value": "<base64>" }
}
```

The `scopes_encrypted` value is a complete, untouched [`LockEnvelope`](https://github.com/orangecheck/oc-lock-protocol/blob/main/SPEC.md) of `kind: "identity"`. Its `from.address` MUST equal the OC Agent envelope's `principal.address`. Its `recipients[]` MUST include exactly the addresses authorized to read the scope set — typically the agent plus zero or more named verifiers.

### 1.2 Plaintext format (the OC Lock payload)

The plaintext sealed inside the OC Lock envelope is a **canonical JSON array** of scope strings (RFC 8785, no whitespace, scope strings sorted lexicographically):

```
["lock:seal(recipient=bc1qalice…)","ln:send(max_sats<=1000)"]
```

Encoded as UTF-8 bytes. The OC Lock `seal()` function takes these bytes as its `payload` argument.

The same scope ordering and canonicalization rules from `SPEC.md` §6 and §7.2 apply: each scope string is in canonical form (constraints sorted by key), and the array is sorted lexicographically.

### 1.3 Canonical message (principal-signed) — unchanged

The principal's outer BIP-322 signature (the `sig` field on the OC Agent envelope) commits to the **same canonical message format as v1.0**:

```
oc-agent:delegation:v1
principal: <btc_address>
agent: <btc_address>
scopes: <scope_1>,<scope_2>,…
bond_sats: <non-negative integer>
bond_attestation: <64-hex | "none">
issued_at: <ISO 8601 UTC>
expires_at: <ISO 8601 UTC>
nonce: <32-hex>
```

The `scopes` line in the canonical message contains the **plaintext** scope list (sorted, canonical, comma-joined per `SPEC.md` §4.1). A v1.2 private-mode envelope therefore commits to the plaintext via two independent signatures by the principal:

1. **Outer signature** (`sig` on the OC Agent envelope): BIP-322 over `id = sha256(canonical_message_bytes)`. Reconstructable by anyone who can recover the plaintext scopes.
2. **Inner signature** (the OC Lock envelope's `sig`): BIP-322 over the OC Lock envelope id. Verifiable by anyone, even without the decryption key.

Together: the principal both *committed to* the plaintext scope set (via the outer sig) and *authorized this set of recipients to decrypt it* (via the inner sig). Neither alone is sufficient; both bind cleanly under the same Bitcoin-address identity.

### 1.4 Envelope id derivation — unchanged

```
id := H(canonical_message_bytes)
```

Identical to v1.0. The id is computed against the **plaintext** canonical message. This means a v1.2 private-mode envelope's id is computed the same way as a v1.0 envelope with the same scopes — there is no v1.2-specific id derivation.

## 2. Verifier algorithm extension

Augment `SPEC.md` §8.1 (delegation verification). All v1.0 steps still apply; the v1.2 extension wraps them.

```
verifyDelegation(envelope):

  v1.2 PRE-VERIFICATION (only when scopes_encrypted is present):

    P1. Mutual exclusion: envelope.scopes and envelope.scopes_encrypted
        MUST NOT both be present. Else E_SCOPES_BOTH_PROVIDED.
    P2. Presence: at least one of scopes / scopes_encrypted MUST be
        present. Else E_SCOPES_NEITHER_PROVIDED.
    P3. Issuer binding: envelope.scopes_encrypted.from.address
        MUST equal envelope.principal.address. Else E_MALFORMED.
    P4. Inner signature: verify the OC Lock envelope per OC Lock SPEC §8.
        If the verifier has a decryption key for any recipient_id, it
        MUST be supplied here (see decryption step P6). Else
        E_BAD_LOCK_ENVELOPE.
    P5. Decryption capability: if the verifier holds an X25519 device
        secret key matching one of envelope.scopes_encrypted.recipients[*],
        proceed to P6. Otherwise return E_SCOPES_UNREADABLE — the
        verifier cannot evaluate authority without the plaintext.
    P6. Decrypt the OC Lock envelope per OC Lock SPEC §8 to recover
        the payload bytes. Parse as canonical JSON array of scope
        strings. Treat the recovered list as `envelope.scopes` for
        the remainder of the algorithm.

  STANDARD VERIFICATION (SPEC.md §8.1 steps 1–7), using either the
  plaintext envelope.scopes (public mode) or the recovered scope list
  (private mode):

    1. v == 1 else E_UNSUPPORTED_VERSION.
    2. shape check else E_MALFORMED.
    3. Reconstruct canonical from the (recovered) scope list and the
       remaining envelope fields per §4.1. Compute id'. Compare to
       envelope.id. Else E_BAD_ID.
    4. Scope grammar valid per §7.1 / §7.3 / §7.6. Else E_BAD_SCOPE_GRAMMAR.
    5. BIP-322(envelope.principal.address, envelope.id) verifies. Else E_BAD_SIG.
    6. Temporal bounds. Else E_NOT_YET_VALID / E_EXPIRED.
    7. Revocation check (§8.1 step 7). Else E_REVOKED.
```

Cross-implementation determinism: every v1.2 verifier holding the same recipient key, the same `now`, and the same revocation set MUST produce identical verdicts.

## 3. Sub-delegation interaction

Each link in a v1.1 sub-delegation chain MAY independently use private mode. Mixed chains are permitted: a public-scope root may have private-scope sub-delegations, and vice versa. The chain-walking verifier (`SUB-DELEGATION.md` §2.2) decrypts each link's scopes independently before applying the per-link containment checks (`step 3g` scope sub-scope relation).

A verifier that can decrypt the root but not an intermediate link MUST return `E_SCOPES_UNREADABLE` — without the intermediate plaintext, the chain's transitive narrowing cannot be checked.

## 4. New error codes (additions to `SPEC.md` §11)

| Code | Meaning |
|---|---|
| `E_SCOPES_BOTH_PROVIDED` | Envelope carries both `scopes` and `scopes_encrypted`. Pick one. |
| `E_SCOPES_NEITHER_PROVIDED` | Envelope carries neither `scopes` nor `scopes_encrypted`. |
| `E_SCOPES_UNREADABLE` | Verifier cannot decrypt `scopes_encrypted` — no held key matches any recipient. |
| `E_BAD_LOCK_ENVELOPE` | The embedded OC Lock envelope failed its own verification (signature, canonical, expiry, etc.). See OC Lock SPEC §8. |

## 5. Worked example

A treasurer (`bc1qceo…`) wants to grant a finance bot (`bc1qfin…`) Lightning-spending authority but **not publish** the per-vendor cap. They add a single verifier (`bc1qauditor…`) for compliance review.

Steps:

1. The treasurer composes the scope list locally:
   ```
   ["ln:send(max_sats<=10000,max_fee_sats<=100)"]
   ```
2. They look up each recipient's OC Lock device record (`device_id`, `device_pk`):
   - `bc1qfin…` → `{ device_id: "fin-prod", device_pk: "<32-byte hex>" }`
   - `bc1qauditor…` → `{ device_id: "auditor-laptop", device_pk: "<32-byte hex>" }`
3. They call OC Lock's `seal({ payload: bytes(JSON.stringify(scopes)), sender: { address: ceo_addr, signMessage }, recipients: […] })` to produce a `LockEnvelope`. The treasurer's wallet is prompted to sign one BIP-322 (the OC Lock envelope's id).
4. They construct the OC Agent canonical message **using the plaintext scopes** and sign it with BIP-322. The treasurer's wallet is prompted a second time.
5. The final OC Agent envelope:
   ```json
   {
       "v": 1, "kind": "agent-delegation",
       "id": "<sha256 of canonical>",
       "principal": { "address": "bc1qceo…", "alg": "bip322" },
       "agent":     { "address": "bc1qfin…", "alg": "bip322" },
       "scopes_encrypted": { /* full LockEnvelope with two recipients */ },
       "issued_at": "2026-04-28T00:00:00Z",
       "expires_at": "2026-07-28T00:00:00Z",
       "bond": null, "nonce": "…",
       "revocation": { "holders": ["principal"], "ref": null },
       "sig": { "alg": "bip322", "pubkey": "bc1qceo…", "value": "<base64>" }
   }
   ```
6. Published to Nostr kind 30083 with the same tag shape as v1.0.

A passive Nostr observer sees:
- principal address (public, fine — Bitcoin addresses are public anyway)
- agent address
- the two recipient addresses on the OC Lock envelope (`bc1qfin…` and `bc1qauditor…`)
- the encrypted ciphertext (opaque)

They do NOT see the scope list. The cap, the destination node, the rate limit — all confidential.

The auditor and the agent each decrypt the OC Lock envelope using their device's X25519 secret, recover the scope list, and verify the OC Agent delegation normally.

## 6. Security additions (to `SPEC.md` §12)

### T17. Relay-observable scope leakage — RESOLVED in private mode

Public-mode v1.0 envelopes leak the scope list to anyone with relay subscription. Private-mode v1.2 envelopes resolve this for non-recipient observers.

### T18. Recipient identity leakage — ACKNOWLEDGED

The OC Lock envelope's `recipients[]` list reveals the recipient `address` and `device_id` of each authorized decryptor. A passive observer sees who can decrypt, just not what. For most use cases (the agent is already named in the OC Agent envelope), this is acceptable. For deployments where recipient identity is itself sensitive, layer a second OC Lock envelope (encrypt the OC Agent envelope itself) or use private channels for distribution. v1.2 does not standardize that pattern.

### T19. Forward-secrecy on key compromise

If a recipient's X25519 device secret is compromised, all past private-mode delegations encrypted to that recipient are decryptable retroactively. Mitigation: the recipient rotates their OC Lock device record (publishes a new device record with a new `device_id` and key); future delegations seal to the new key. Past delegations remain decryptable by the compromised key holder (and so should be revoked if their secrecy still matters).

### T20. Cross-mode replay

A principal cannot replay a v1.0 public envelope as a v1.2 private envelope, or vice versa, because the BIP-322 signature commits to the canonical message which contains the plaintext scopes. The mode is a serialization choice, not a signed-content choice. An attempted "downgrade" (extracting plaintext from a sealed envelope and re-publishing as public) is not technically a replay — it's an authorized re-publish, and the principal anticipated this when they sealed (anyone with the plaintext can publish it). Verifiers MUST treat the two modes as equivalent at the authority level.

## 7. Backwards compatibility

A v1.0 verifier encountering a v1.2 private-mode envelope:
1. Sees `kind: "agent-delegation"` — recognized.
2. Iterates required fields per `SPEC.md` §4.4 — finds `scopes` is missing, fails `E_MALFORMED`.
3. Does not attempt the `scopes_encrypted` field (it's not in the v1.0 schema).
4. Returns the `E_MALFORMED` rejection. **Correct fail-closed behavior** — a verifier that doesn't understand scope encryption MUST NOT accept the delegation.

A v1.2 verifier encountering a v1.0 public-mode envelope:
1. Sees `scopes` present and `scopes_encrypted` absent.
2. Skips the v1.2 PRE-VERIFICATION block.
3. Runs `SPEC.md` §8.1 unchanged.
4. **Identical verdict to a v1.0 verifier.** No existing test vector v01–v14 changes verdict under v1.2.

## 8. Implementer's checklist (additions to `SPEC.md` §14)

- [ ] Recognizes `scopes_encrypted` as an optional alternative to `scopes` in delegation envelopes; rejects envelopes with both or neither.
- [ ] Embeds an unmodified `LockEnvelope` (`kind: "identity"`, version 2) as the value of `scopes_encrypted`.
- [ ] On issue: seals the canonical scope list (UTF-8 of canonical JSON array) via OC Lock's `seal()` with the principal as sender and the agent + verifiers as recipients.
- [ ] On verify: decrypts the OC Lock envelope using the verifier's device secret key (if held), parses the payload as a canonical JSON array of scope strings, treats the result as `envelope.scopes` for the remaining `SPEC.md` §8.1 algorithm.
- [ ] Returns `E_SCOPES_UNREADABLE` cleanly when no held key matches.
- [ ] Returns `E_BAD_LOCK_ENVELOPE` when the OC Lock envelope itself fails verification (its own signature, canonical, expiry).
- [ ] Composes correctly with v1.1 sub-delegation: each chain link's `scopes_encrypted` is independently decryptable.
- [ ] Rejects v1.0 envelopes with `scopes_encrypted` present (the field is reserved by this v1.2 extension).
- [ ] Passes test vectors `v15-private-scope-minimal.json`, `v16-private-scope-multi-recipient.json`, `v17-private-scope-no-key-fails-closed.json`.

## 9. Nostr publication

No changes to `SPEC.md` §10 Nostr directory format. The same `kind: 30083` event, same `d`-tag (`oc-agent-del:<id>`), same indexing tags. The envelope's `content` field carries the v1.2-shaped JSON exactly as v1.0 carries v1.0-shaped JSON.

The set of indexable tags is unchanged — `principal`, `agent`, `expires`, and one `scope` tag per **plaintext** scope. In private mode, the principal MAY emit `scope` tags to enable scope-keyed discovery for known recipients while keeping the encrypted body authoritative; or MAY omit them for stricter privacy. Verifiers MUST treat tags as untrusted hints and rely solely on the decrypted payload.

## 10. IANA / external identifiers (additions to `SPEC.md` §16)

- No new Nostr kinds.
- No new file extensions or MIME types — a v1.2 private-mode delegation is still `.delegation` / `application/vnd.oc-agent.delegation+json`.
- New error codes (§4 above) registered in `SPEC.md` §11.
- Cryptographic dependency: [`@orangecheck/lock-core` v0.x](https://github.com/orangecheck/oc-lock-protocol) supplies the seal/unseal primitives. The OC Lock SPEC governs the inner envelope's wire format and verification.

---

End of v1.2 private-scope extension.
