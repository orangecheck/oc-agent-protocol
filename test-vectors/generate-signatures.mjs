#!/usr/bin/env node
/**
 * Signature vector generator for OC Agent (v67-v75).
 *
 *   node test-vectors/generate-signatures.mjs
 *
 * One delegation and one action under it per address type, both signed by the
 * same disclosed burn key (it is the principal and the agent), so a second
 * implementation can check its BIP-322 wiring against real signatures: P2PKH
 * (legacy BIP-137 form), P2SH-P2WPKH, P2WPKH and P2TR (BIP-322 simple form).
 * v75 is v72 with one byte of the action's signature flipped: its delegation
 * (v71) still verifies, and the action MUST NOT (E_BAD_ACTION_STAMP).
 *
 * The private keys below are published and never to be used for funds.
 * Anyone can spend what is sent to their addresses. They are the keys
 * oc-stamp-protocol's v10-v14 and oc-vote-protocol's v19-v23 use; #1 and #2
 * are oc-attest-protocol's tv21 and tv22 keys.
 *
 * Dependencies (bip322-js 3, bitcoinjs-lib 6, ecpair 2,
 * @bitcoinerlab/secp256k1) come from a node_modules that has them: by default
 * oc-packages/wallet-adapter in a clone next to this repository, or the
 * directory in OC_SIGNER_NODE_MODULES. ECDSA signing is RFC 6979
 * deterministic; a P2TR signature can differ on each run and still verifies.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES =
    process.env.OC_SIGNER_NODE_MODULES ??
    join(HERE, '..', '..', 'oc-packages', 'wallet-adapter', 'node_modules');
const require = createRequire(join(MODULES, '_.js'));
const bip322 = require('bip322-js');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@bitcoinerlab/secp256k1');
const { ECPairFactory } = require('ecpair');
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.bitcoin;

// Disclosed burn keys. Never send bitcoin to the addresses they derive.
const KEYS = {
    p2wpkh: '01'.repeat(32), // oc-attest-protocol key #1 (tv21)
    p2tr: '02'.repeat(32), // oc-attest-protocol key #2 (tv22)
    p2pkh: '03'.repeat(32),
    p2sh_p2wpkh: '04'.repeat(32),
};

function keyPair(hex) {
    return ECPair.fromPrivateKey(Buffer.from(hex, 'hex'), { network });
}

function addressOf(type, hex) {
    const pubkey = Buffer.from(keyPair(hex).publicKey);
    if (type === 'p2pkh') return bitcoin.payments.p2pkh({ pubkey, network }).address;
    if (type === 'p2wpkh') return bitcoin.payments.p2wpkh({ pubkey, network }).address;
    if (type === 'p2sh_p2wpkh')
        return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network })
            .address;
    if (type === 'p2tr')
        return bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33), network }).address;
    throw new Error(`unknown address type ${type}`);
}

// SPEC §4.1 and §5.1: LF between lines, no trailing LF. The one scope below is
// already in §7.3's canonical form, so it is written as given.
function delegationMessage(i) {
    return [
        'oc-agent:delegation:v1',
        `principal: ${i.principal}`,
        `agent: ${i.agent}`,
        `scopes: ${i.scopes.join(',')}`,
        `bond_sats: ${i.bond ? i.bond.sats : 0}`,
        `bond_attestation: ${i.bond ? i.bond.attestation_id : 'none'}`,
        `issued_at: ${i.issued_at}`,
        `expires_at: ${i.expires_at}`,
        `nonce: ${i.nonce}`,
    ].join('\n');
}

function actionMessage(i) {
    return [
        'oc-agent:action:v1',
        `address: ${i.address}`,
        `content_hash: ${i.content_hash}`,
        `content_length: ${i.content_length}`,
        `content_mime: ${i.content_mime}`,
        `signed_at: ${i.signed_at}`,
        `delegation_id: ${i.delegation_id}`,
        `scope_exercised: ${i.scope_exercised}`,
    ].join('\n');
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// The two builders above must give v01's and v03's bytes and ids, or nothing is written.
for (const [file, build] of [
    ['v01-delegation-minimal.json', delegationMessage],
    ['v03-action-minimal.json', actionMessage],
]) {
    const v = JSON.parse(readFileSync(join(HERE, file), 'utf8'));
    const msg = build(v.inputs);
    if (msg !== v.expected.canonical_message || sha256(msg) !== v.expected.id)
        throw new Error(`${file}: the canonical message builder does not reproduce it`);
}

const v01 = JSON.parse(readFileSync(join(HERE, 'v01-delegation-minimal.json'), 'utf8'));
const v03 = JSON.parse(readFileSync(join(HERE, 'v03-action-minimal.json'), 'utf8'));

/** v01's delegation and v03's action, with `address` as the principal, the agent and the signer. */
function signedPair(type) {
    const address = addressOf(type, KEYS[type]);
    const wif = keyPair(KEYS[type]).toWIF();
    const sign = (id) => {
        // SPEC §4.5: the wallet signs the 64-character hex id.
        const sig = bip322.Signer.sign(wif, address, id);
        if (!bip322.Verifier.verifySignature(address, id, sig))
            throw new Error(`${type}: bip322-js does not verify its own signature`);
        return sig;
    };

    const dIn = { ...v01.inputs, principal: address, agent: address };
    const dMsg = delegationMessage(dIn);
    const dId = sha256(dMsg);
    const delegation = {
        v: 1,
        kind: 'agent-delegation',
        id: dId,
        principal: { address, alg: 'bip322' },
        agent: { address, alg: 'bip322' },
        scopes: dIn.scopes,
        bond: null,
        issued_at: dIn.issued_at,
        expires_at: dIn.expires_at,
        nonce: dIn.nonce,
        revocation: { holders: ['principal'], ref: null },
        sig: { alg: 'bip322', pubkey: address, value: sign(dId) },
    };

    const aIn = { ...v03.inputs, address, delegation_id: dId };
    const aMsg = actionMessage(aIn);
    const aId = sha256(aMsg);
    const action = {
        v: 1,
        kind: 'agent-action',
        id: aId,
        content: {
            hash: aIn.content_hash,
            length: aIn.content_length,
            mime: aIn.content_mime,
            ref: aIn.content_ref,
        },
        signer: { address, alg: 'bip322' },
        signed_at: aIn.signed_at,
        delegation_id: dId,
        scope_exercised: aIn.scope_exercised,
        ots: aIn.ots,
        sig: { alg: 'bip322', pubkey: address, value: sign(aId) },
    };
    return {
        delegation: { inputs: dIn, message: dMsg, id: dId, envelope: delegation },
        action: { inputs: aIn, message: aMsg, id: aId, envelope: action },
    };
}

function vector({ description, kind, part, type, format, outcome, crossRefs }) {
    return {
        description,
        kind,
        inputs: part.inputs,
        expected: {
            canonical_message: part.message,
            canonical_message_bytes_len: Buffer.byteLength(part.message, 'utf8'),
            id: part.id,
            envelope: part.envelope,
        },
        signature_check: {
            address_type: type,
            format,
            signed_message: part.id,
            expected: outcome,
        },
        ...(crossRefs ? { cross_refs: crossRefs } : {}),
    };
}

const TYPES = [
    [67, 'p2pkh', 'bip137', 'P2PKH, a legacy BIP-137 signature'],
    [69, 'p2sh_p2wpkh', 'bip322-simple', 'P2SH-P2WPKH, a BIP-322 simple signature'],
    [71, 'p2wpkh', 'bip322-simple', 'P2WPKH, a BIP-322 simple signature'],
    [73, 'p2tr', 'bip322-simple', 'P2TR key path, a BIP-322 simple signature'],
];
const slug = (type) => type.replace('_', '-');

const out = [];
let p2wpkh;
for (const [n, type, format, what] of TYPES) {
    const pair = signedPair(type);
    if (type === 'p2wpkh') p2wpkh = { pair, delegationFile: null, n };
    const dFile = `v${n}-sig-${slug(type)}-delegation.json`;
    const aFile = `v${n + 1}-sig-${slug(type)}-action.json`;
    if (type === 'p2wpkh') p2wpkh.delegationFile = dFile;
    out.push({
        file: dFile,
        body: vector({
            description: `${what}: v01's delegation with one disclosed burn key as both principal and agent, signed over its hex id; MUST verify`,
            kind: 'delegation',
            part: pair.delegation,
            type,
            format,
            outcome: { outcome: 'ACCEPT' },
        }),
    });
    out.push({
        file: aFile,
        body: vector({
            description: `${what}: v03's action under ${dFile.slice(0, 3)}, signed by the same key as agent over its hex id; MUST verify`,
            kind: 'action',
            part: pair.action,
            type,
            format,
            outcome: { outcome: 'ACCEPT' },
            crossRefs: { delegation_vector: dFile },
        }),
    });
}

// v75: v72 with the middle byte of the action's signature flipped; length and base64 shape unchanged.
{
    const action = structuredClone(p2wpkh.pair.action);
    action.envelope = structuredClone(out.find((o) => o.file === 'v72-sig-p2wpkh-action.json').body.expected.envelope);
    const bytes = Buffer.from(action.envelope.sig.value, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    action.envelope.sig.value = bytes.toString('base64');
    if (bip322.Verifier.verifySignature(action.envelope.signer.address, action.id, action.envelope.sig.value))
        throw new Error('v75: the flipped signature still verifies');
    out.push({
        file: 'v75-sig-action-tampered.json',
        body: vector({
            description:
                "v72 with one byte of the action's signature flipped: its delegation (v71) verifies, the action MUST NOT (E_BAD_ACTION_STAMP, SPEC §8.2 step 8)",
            kind: 'action',
            part: action,
            type: 'p2wpkh',
            format: 'bip322-simple',
            outcome: { outcome: 'REJECT', error_code: 'E_BAD_ACTION_STAMP' },
            crossRefs: { delegation_vector: p2wpkh.delegationFile },
        }),
    });
}

for (const { file, body } of out) {
    writeFileSync(join(HERE, file), JSON.stringify(body, null, 4) + '\n', 'utf8');
    console.log(`${file}: ${body.expected.id}`);
}
