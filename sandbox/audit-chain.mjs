import { createHash } from 'node:crypto';
import { Fault } from './engine.mjs';
import { canonical, signReceipt, verifyReceipt, publicKeys } from './pqc.mjs';

const GENESIS_HASH = createHash('sha384').update('AtlasPay::AuditChain::Genesis::v1').digest('hex');

const sha384 = value => createHash('sha384').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

/**
 * Computes a SHA-384 Merkle root over an ordered list of entry hashes.
 */
export function computeMerkleRoot(hashes) {
  if (!hashes.length) return GENESIS_HASH;
  let layer = hashes.slice();
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(sha384({ left, right }));
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Generates a Merkle inclusion proof for a specific entry index.
 */
export function merkleProof(hashes, targetIndex) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= hashes.length) {
    throw new Fault('Audit chain entry index out of range', 404);
  }
  const siblings = [];
  let idx = targetIndex;
  let layer = hashes.slice();
  while (layer.length > 1) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    siblings.push({
      position: isRight ? 'left' : 'right',
      hash: layer[siblingIdx] ?? layer[idx]
    });
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha384({ left: layer[i], right: layer[i + 1] ?? layer[i] }));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return { root: layer[0], leaf: hashes[targetIndex], index: targetIndex, siblings };
}

/**
 * Verifies a Merkle inclusion proof against an expected root hash.
 */
export function verifyMerkleProof(proof) {
  if (!proof || typeof proof.leaf !== 'string' || typeof proof.root !== 'string' || !Array.isArray(proof.siblings)) {
    return false;
  }
  let current = proof.leaf;
  for (const step of proof.siblings) {
    current = step.position === 'left'
      ? sha384({ left: step.hash, right: current })
      : sha384({ left: current, right: step.hash });
  }
  return current === proof.root;
}

/**
 * Appends any unchained audit log events chronologically onto the workspace hash chain.
 */
export function syncAuditChain(state) {
  state.auditChain ??= [];
  const seen = new Set(state.auditChain.map(e => e.auditId));
  const pending = [...(state.audit || [])].reverse().filter(a => !seen.has(a.id));
  for (const item of pending) {
    const seq = state.auditChain.length + 1;
    const prevHash = state.auditChain.length ? state.auditChain[state.auditChain.length - 1].entryHash : GENESIS_HASH;
    const payload = {
      seq,
      auditId: item.id,
      action: item.action,
      reference: item.reference,
      actor: item.actor,
      at: item.at,
      prevHash
    };
    state.auditChain.push({ ...payload, entryHash: sha384(payload) });
  }
  return state.auditChain;
}

/**
 * Verifies hash-chain continuity, audit record consistency, and signed Merkle checkpoint.
 */
export function verifyAuditChain(state, keys = []) {
  const chain = state.auditChain || [];
  const auditById = new Map((state.audit || []).map(a => [a.id, a]));
  let expectedPrev = GENESIS_HASH;
  let brokenAt = null;
  let reason = null;

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    if (entry.seq !== i + 1 || entry.prevHash !== expectedPrev) {
      brokenAt = i;
      reason = 'Hash-chain sequence or prevHash mismatch';
      break;
    }
    const source = auditById.get(entry.auditId);
    if (!source || source.action !== entry.action || source.reference !== entry.reference || source.actor !== entry.actor || source.at !== entry.at) {
      brokenAt = i;
      reason = 'Audit record content tampered or missing';
      break;
    }
    const recomputed = sha384({
      seq: entry.seq,
      auditId: entry.auditId,
      action: entry.action,
      reference: entry.reference,
      actor: entry.actor,
      at: entry.at,
      prevHash: entry.prevHash
    });
    if (recomputed !== entry.entryHash) {
      brokenAt = i;
      reason = 'Entry SHA-384 digest mismatch';
      break;
    }
    expectedPrev = entry.entryHash;
  }

  const merkleRoot = computeMerkleRoot(chain.map(e => e.entryHash));
  const headHash = chain.length ? chain[chain.length - 1].entryHash : GENESIS_HASH;

  let checkpointValid = null;
  if (state.ledgerCheckpoint?.attestation) {
    const k = keys.find(item => item.id === state.ledgerCheckpoint.attestation.keyId);
    checkpointValid = !!k
      && verifyReceipt(state.ledgerCheckpoint.attestation, publicKeys(k))
      && state.ledgerCheckpoint.merkleRoot === merkleRoot
      && state.ledgerCheckpoint.count === chain.length;
  }

  return {
    intact: brokenAt === null,
    brokenAt,
    reason,
    count: chain.length,
    genesisHash: GENESIS_HASH,
    headHash,
    merkleRoot,
    checkpoint: state.ledgerCheckpoint ? {
      at: state.ledgerCheckpoint.at,
      count: state.ledgerCheckpoint.count,
      merkleRoot: state.ledgerCheckpoint.merkleRoot,
      keyId: state.ledgerCheckpoint.attestation?.keyId,
      valid: checkpointValid
    } : null,
    entries: chain.slice(-25).reverse()
  };
}

/**
 * Signs a dual ML-DSA-65 + Ed25519 Merkle checkpoint certificate for the workspace audit chain.
 */
export function anchorMerkleCheckpoint(state, activeKey) {
  syncAuditChain(state);
  const report = verifyAuditChain(state, [activeKey]);
  if (!report.intact) {
    throw new Fault('Cannot anchor tampered audit chain: ' + (report.reason || 'integrity check failed'), 409);
  }
  const payload = {
    kind: 'atlaspay-merkle-checkpoint',
    version: 1,
    count: report.count,
    genesisHash: report.genesisHash,
    headHash: report.headHash,
    merkleRoot: report.merkleRoot,
    at: new Date().toISOString()
  };
  const attestation = signReceipt(payload, activeKey);
  state.ledgerCheckpoint = { ...payload, attestation };
  return { certificate: state.ledgerCheckpoint, publicKey: publicKeys(activeKey) };
}
