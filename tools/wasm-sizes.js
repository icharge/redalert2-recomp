// Largest function bodies and local counts in a wasm module: how close the lifted code is to
// V8 limits (docs/web/toolchain.md). usage: node tools/wasm-sizes.js build-web/ra2.wasm
const fs = require('fs');
const b = fs.readFileSync(process.argv[2]);
let p = 8;
const u32 = () => { let r = 0, s = 0, c; do { c = b[p++]; r |= (c & 0x7f) << s; s += 7; } while (c & 0x80); return r >>> 0; };
let funcs = [];
while (p < b.length) {
  const id = b[p++], size = u32(), end = p + size;
  if (id === 10) {
    const n = u32();
    for (let i = 0; i < n; i++) {
      const sz = u32(), start = p;
      const groups = u32();
      let locals = 0;
      for (let g = 0; g < groups; g++) { locals += u32(); p++; }
      funcs.push({ index: i, bytes: sz, locals });
      p = start + sz;
    }
  }
  p = end;
}
funcs.sort((a, c) => c.bytes - a.bytes);
console.log('functions:', funcs.length);
console.log('largest bodies (bytes, locals):');
for (const f of funcs.slice(0, 5)) console.log(' ', f.bytes, f.locals, '(code index ' + f.index + ')');
console.log('most locals:', Math.max(...funcs.map(f => f.locals)));
console.log('V8 limits: body 7654321 bytes, locals 50000');
