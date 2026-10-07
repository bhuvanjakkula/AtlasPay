import { readFile, writeFile } from 'node:fs/promises';
import { unseal, publicKeys, verifyReceipt, canonical } from './pqc.mjs';
const [archivePath,keyringPath,outputPath]=process.argv.slice(2);
if(!archivePath||!keyringPath||!outputPath)throw Error('Usage: node sandbox/decrypt-export.mjs archive.json trusted-keyring.json output.json');
const archive=JSON.parse(await readFile(archivePath,'utf8')),ring=JSON.parse(await readFile(keyringPath,'utf8'));
const key=ring.keys.find(k=>k.id===archive.envelope.keyId);if(!key)throw Error('Required decryption key is not in the trusted local keyring');
if(!verifyReceipt(archive.attestation,publicKeys(key))||canonical(archive.attestation.payload)!==canonical(archive.envelope))throw Error('Invalid archive signatures');
const result=unseal(archive.envelope,key);await writeFile(outputPath,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log('Archive signatures verified and decrypted to a new file. No wallet state was restored.');
