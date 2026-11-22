import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Run one program; returns [stdout bytes, exit code].
function run(p: Buffer, inp: Buffer): [Buffer, number] {
  const s = new Int32Array(256); // data stack
  const c = new Int32Array(64); // call stack
  const m = new Int32Array(256); // memory
  const out: number[] = [];
  let sp = 0, cp = 0, pc = 0, steps = 0, ip = 0;
  const n = p.length;
  const done = (e: number): [Buffer, number] => [Buffer.from(out), e];
  while (true) {
    if (steps >= 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    const ok = op <= 7 || (op >= 0x10 && op <= 0x22) || (op >= 0x30 && op <= 0x34)
      || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53);
    if (!ok) return done(5);
    if (pc + 1 + imm > n) return done(9);
    // Stack needs: pops first, then push room (trap 2 before trap 3).
    let need = 0, push = 0;
    if (op === 1 || op === 2 || op === 0x52) { need = 0; push = 1; }
    else if (op === 3 || op === 0x31 || op === 0x32 || op === 0x50 || op === 0x51 || op === 0x53) { need = 1; push = 0; }
    else if (op === 4) { need = 1; push = 2; }
    else if (op === 6) { need = 2; push = 3; }
    else if (op === 5) { need = 2; push = 2; }
    else if (op === 7) { need = 3; push = 3; }
    else if (op >= 0x10 && op <= 0x22) { need = op === 0x17 || op === 0x1b ? 1 : 2; push = 1; }
    else if (op === 0x40) { need = 1; push = 1; }
    else if (op === 0x41) { need = 2; push = 0; }
    if (sp < need) return done(2);
    if (sp - need + push > 256) return done(3);
    steps++;
    const nx = pc + 1 + imm;
    const off16 = () => ((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: s[sp++] = (p[pc + 1] << 24) >> 24; break;
      case 0x02: s[sp++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24); break;
      case 0x03: sp--; break;
      case 0x04: s[sp] = s[sp - 1]; sp++; break;
      case 0x05: { const t = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = t; break; }
      case 0x06: s[sp] = s[sp - 2]; sp++; break;
      case 0x07: { const t = s[sp - 3]; s[sp - 3] = s[sp - 2]; s[sp - 2] = s[sp - 1]; s[sp - 1] = t; break; }
      case 0x10: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] + b) | 0; break; }
      case 0x11: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] - b) | 0; break; }
      case 0x12: { const b = s[--sp]; s[sp - 1] = Math.imul(s[sp - 1], b); break; }
      case 0x13: { const b = s[--sp], a = s[sp - 1]; if (b === 0) return done(4); s[sp - 1] = (a / b) | 0; break; }
      case 0x14: { const b = s[--sp], a = s[sp - 1]; if (b === 0) return done(4); s[sp - 1] = a % b; break; }
      case 0x15: { const b = s[--sp], a = s[sp - 1], u = b >>> 0; if (!u) return done(4); s[sp - 1] = ((a >>> 0) / u) | 0; break; }
      case 0x16: { const b = s[--sp], a = s[sp - 1], u = b >>> 0; if (!u) return done(4); s[sp - 1] = ((a >>> 0) % u) | 0; break; }
      case 0x17: s[sp - 1] = -s[sp - 1]; break;
      case 0x18: { const b = s[--sp]; s[sp - 1] &= b; break; }
      case 0x19: { const b = s[--sp]; s[sp - 1] |= b; break; }
      case 0x1a: { const b = s[--sp]; s[sp - 1] ^= b; break; }
      case 0x1b: s[sp - 1] = ~s[sp - 1]; break;
      case 0x1c: { const b = s[--sp]; s[sp - 1] <<= b & 31; break; }
      case 0x1d: { const b = s[--sp]; s[sp - 1] >>= b & 31; break; }
      case 0x1e: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] >>> (b & 31)) | 0; break; }
      case 0x20: { const b = s[--sp]; s[sp - 1] = s[sp - 1] === b ? 1 : 0; break; }
      case 0x21: { const b = s[--sp]; s[sp - 1] = s[sp - 1] < b ? 1 : 0; break; }
      case 0x22: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] >>> 0) < (b >>> 0) ? 1 : 0; break; }
      case 0x30: pc = nx + off16(); continue;
      case 0x31: { const v = s[--sp]; pc = v === 0 ? nx + off16() : nx; continue; }
      case 0x32: { const v = s[--sp]; pc = v !== 0 ? nx + off16() : nx; continue; }
      case 0x33: if (cp >= 64) return done(7); c[cp++] = nx; pc = p[pc + 1] | (p[pc + 2] << 8); continue;
      case 0x34: if (cp === 0) return done(8); pc = c[--cp]; continue;
      case 0x40: { const a = s[sp - 1]; if (a < 0 || a > 255) return done(6); s[sp - 1] = m[a]; break; }
      case 0x41: { const a = s[--sp], v = s[--sp]; if (a < 0 || a > 255) return done(6); m[a] = v; break; }
      case 0x50: { const v = s[--sp], t = String(v); if (out.length + t.length > 65536) return done(11); for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i)); break; }
      case 0x51: { const v = s[--sp]; if (out.length >= 65536) return done(11); out.push(v & 255); break; }
      case 0x52: s[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return done(s[--sp] & 255);
    }
    pc = nx;
  }
}

for (const id of readdirSync(I).sort()) {
  const dir = join(I, id);
  const [o, e] = run(readFileSync(join(dir, 'program.bin')), readFileSync(join(dir, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), o);
  writeFileSync(join(O, id, 'exit.txt'), String(e) + '\n');
}
