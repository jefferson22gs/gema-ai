/**
 * Propósito: gera os ícones do PWA (PNG) a partir do monograma vetorial do projeto, sem dependências externas.
 * Uso: npm run icons  (saída em public/icons). Reutilizável: SIM.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x11, 0x13, 0x18];
const GOLD = [0xb8, 0xa1, 0x77];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Distância de ponto a segmento (para traçar as linhas do losango). */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function png(size, { maskable = false } = {}) {
  const pad = maskable ? 0.2 : 0.12;
  const s = (v) => (pad + (v / 32) * (1 - 2 * pad)) * size;
  // Mesma geometria do GemaMark (viewBox 32): contorno + facetas.
  const segs = [
    [16, 3, 28, 12], [28, 12, 16, 29], [16, 29, 4, 12], [4, 12, 16, 3],
    [4, 12, 28, 12], [11, 12, 16, 3], [16, 3, 21, 12], [21, 12, 16, 29], [16, 29, 11, 12],
  ].map(([a, b, c, d]) => [s(a), s(b), s(c), s(d)]);
  const stroke = Math.max(1.2, size * 0.035);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let d = Infinity;
      for (const [ax, ay, bx, by] of segs) d = Math.min(d, distSeg(x + 0.5, y + 0.5, ax, ay, bx, by));
      const a = Math.max(0, Math.min(1, stroke / 2 + 0.5 - d));
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + GOLD[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
writeFileSync("public/icons/icon-maskable-512.png", png(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", png(180, { maskable: true }));
writeFileSync(
  "public/icons/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#111318"/><g fill="none" stroke="#B8A177" stroke-linejoin="round" transform="translate(3.2 3.2) scale(.8)"><path d="M16 3 28 12 16 29 4 12Z" stroke-width="1.8"/><path d="M4 12h24M11 12l5-9 5 9-5 17-5-17Z" stroke-width="1.3" opacity=".75"/></g></svg>`,
);
console.log("Ícones gerados em public/icons");
