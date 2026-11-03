import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const packed = fs.readFileSync('app-data.b64', 'utf8').trim();
const files = JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));
for (const [name, contents] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(name), { recursive:true });
  fs.writeFileSync(name, contents, 'utf8');
}
console.log('Editor preparado com',Object.keys(files).length,'arquivos');
