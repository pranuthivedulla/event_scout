// Spike 8: does Gemini TTS return usable WAV audio?
// Verifies the request shape, the response path, and that the bytes are a
// valid RIFF/WAVE file before any of it goes into the app.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spike', 'out');
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const MODEL = 'gemini-3.8-flash-tts';
const script =
  'Three deadlines need you this week. ' +
  'Structuring the AI Way, Mumbai, is in twelve days. ' +
  'BitGo and Giottus on crypto custody, Bengaluru, is in twelve days. ' +
  'And E T B F S I Converge, Mumbai, is in fifty nine days. ' +
  'None of these published a registration deadline, so those are event dates.';

const body = {
  model: MODEL,
  input: [{
    type: 'user_input',
    content: [{
      type: 'text',
      text: script,
      annotations: [{ type: 'speech_metadata', style: 'calm, clear, matter of fact' }],
    }],
  }],
  response_format: { type: 'audio' },
  generation_config: { speech_config: [{ voice: 'Kore' }] },
};

const t0 = Date.now();
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
  method: 'POST',
  headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!res.ok) {
  console.log(text.slice(0, 600));
  process.exit(1);
}

const json = JSON.parse(text);
writeFileSync(join(OUT, 'tts.raw.json'), JSON.stringify(json, null, 2).slice(0, 4000));

console.log('step types:', (json.steps || []).map((s) => s.type).join(', '));

let b64 = null;
let mime = null;
for (const s of json.steps || []) {
  if (s.type !== 'model_output') continue;
  for (const c of s.content || []) {
    if (c.type === 'audio' && c.data) { b64 = c.data; mime = c.mime_type || c.mimeType || null; }
  }
}
if (!b64) {
  console.log('NO AUDIO FOUND. content types seen:',
    (json.steps || []).flatMap((s) => (s.content || []).map((c) => c.type)).join(', '));
  process.exit(1);
}

const buf = Buffer.from(b64, 'base64');
writeFileSync(join(OUT, 'deadlines.wav'), buf);

const riff = buf.subarray(0, 4).toString('ascii');
const wave = buf.subarray(8, 12).toString('ascii');
const channels = buf.readUInt16LE(22);
const rate = buf.readUInt32LE(24);
const bits = buf.readUInt16LE(34);
const dataLen = buf.length - 44;
const seconds = dataLen / (rate * channels * (bits / 8));

console.log(`mime        : ${mime ?? '(not stated)'}`);
console.log(`bytes       : ${buf.length} (${(buf.length / 1024).toFixed(0)} KB)`);
console.log(`header      : ${riff}/${wave} ${riff === 'RIFF' && wave === 'WAVE' ? 'valid WAV' : 'NOT A WAV'}`);
console.log(`format      : ${rate} Hz, ${channels} channel, ${bits}-bit`);
console.log(`duration    : ${seconds.toFixed(1)}s`);
console.log(`tokens      : ${JSON.stringify(json.usage?.total_tokens ?? json.usage ?? 'n/a')}`);
console.log(`\n-> spike/out/deadlines.wav`);
