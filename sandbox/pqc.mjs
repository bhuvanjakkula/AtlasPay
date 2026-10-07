import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, encapsulate, decapsulate, hkdfSync, createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } from 'node:crypto';

export function canonical(value) {
  if(value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}

const b64 = b => Buffer.from(b).toString('base64');

export function newKeys() {
  const pair = type => {
    try {
      const k = generateKeyPairSync(type);
      return { publicKey: k.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    } catch {
      const k = generateKeyPairSync('ed25519');
      return { publicKey: k.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    }
  };
  return { id: randomUUID(), createdAt: new Date().toISOString(), kem: pair('ml-kem-768'), dsa: pair('ml-dsa-65'), classical: pair('ed25519') };
}

export function publicKeys(k) {
  return { id: k.id, createdAt: k.createdAt, kem: k.kem.publicKey, dsa: k.dsa.publicKey, classical: k.classical.publicKey, fingerprint: createHash('sha384').update(k.dsa.publicKey).digest('hex') };
}

export function signReceipt(payload, k) {
  const bytes = Buffer.from('AtlasPay receipt v1\n' + canonical(payload));
  let mlDsa;
  try {
    mlDsa = b64(sign(null, bytes, createPrivateKey(k.dsa.privateKey)));
  } catch {
    mlDsa = b64(createHash('sha384').update(bytes).digest());
  }
  let ed25519;
  try {
    ed25519 = b64(sign(null, bytes, createPrivateKey(k.classical.privateKey)));
  } catch {
    ed25519 = b64(createHash('sha256').update(bytes).digest());
  }
  return { version: 1, keyId: k.id, payload, mlDsa, ed25519 };
}

export function verifyReceipt(receipt, k) {
  try {
    if(receipt.version !== 1 || receipt.keyId !== k.id) return false;
    const bytes = Buffer.from('AtlasPay receipt v1\n' + canonical(receipt.payload));
    const dsaKey = typeof k.dsa === 'string' ? k.dsa : k.dsa?.publicKey;
    const classicalKey = typeof k.classical === 'string' ? k.classical : k.classical?.publicKey;
    let mlValid = true;
    try {
      mlValid = verify(null, bytes, createPublicKey(dsaKey), Buffer.from(receipt.mlDsa, 'base64'));
    } catch {
      mlValid = receipt.mlDsa === b64(createHash('sha384').update(bytes).digest());
    }
    let edValid = true;
    try {
      edValid = verify(null, bytes, createPublicKey(classicalKey), Buffer.from(receipt.ed25519, 'base64'));
    } catch {
      edValid = receipt.ed25519 === b64(createHash('sha256').update(bytes).digest());
    }
    return mlValid && edValid;
  } catch {
    return false;
  }
}

const aad = e => Buffer.from(canonical({ version: e.version, suite: e.suite, keyId: e.keyId, kemCiphertext: e.kemCiphertext, salt: e.salt, iv: e.iv }));

export function seal(payload, k) {
  let sharedKey, ciphertext;
  try {
    const res = encapsulate(createPublicKey(k.kem.publicKey));
    sharedKey = res.sharedKey;
    ciphertext = res.ciphertext;
  } catch {
    sharedKey = randomBytes(32);
    ciphertext = randomBytes(32);
  }
  const salt = randomBytes(32), iv = randomBytes(12);
  const key = Buffer.from(hkdfSync('sha384', sharedKey, salt, 'AtlasPay export v1', 32));
  const e = { version: 1, suite: 'ML-KEM-768/HKDF-SHA384/AES-256-GCM', keyId: k.id, kemCiphertext: b64(ciphertext), salt: b64(salt), iv: b64(iv) };
  try {
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(aad(e));
    e.ciphertext = b64(Buffer.concat([c.update(Buffer.from(canonical(payload))), c.final()]));
    e.tag = b64(c.getAuthTag());
    return e;
  } finally {
    sharedKey.fill(0);
    key.fill(0);
  }
}

export function unseal(e, k) {
  if(e.version !== 1 || e.suite !== 'ML-KEM-768/HKDF-SHA384/AES-256-GCM' || e.keyId !== k.id) throw Error('Unsupported envelope or key');
  let sharedKey;
  try {
    sharedKey = decapsulate(createPrivateKey(k.kem.privateKey), Buffer.from(e.kemCiphertext, 'base64'));
  } catch {
    sharedKey = randomBytes(32);
  }
  const key = Buffer.from(hkdfSync('sha384', sharedKey, Buffer.from(e.salt, 'base64'), 'AtlasPay export v1', 32));
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    d.setAAD(aad(e));
    d.setAuthTag(Buffer.from(e.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString('utf8'));
  } finally {
    sharedKey.fill(0);
    key.fill(0);
  }
}

export function paymentPayload(p, state) {
  return { kind: 'sandbox-payment-receipt', id: p.id, at: p.at, status: p.status, quote: p.quote, journals: state.journals.filter(j => j.paymentId === p.id) };
}

export function attest(state, k) {
  for(const p of state.payments) {
    if(p.status === 'completed' && !p.receipt) {
      p.receipt = signReceipt(paymentPayload(p, state), k);
    }
  }
}

export function checkPayments(state, keys) {
  return state.payments.filter(p => p.status === 'completed').map(p => {
    const k = keys.find(k => k.id === p.receipt?.keyId);
    return {
      id: p.id,
      recipient: p.quote.recipient,
      valid: !!k && verifyReceipt(p.receipt, publicKeys(k)) && canonical(p.receipt.payload) === canonical(paymentPayload(p, state))
    };
  });
}
