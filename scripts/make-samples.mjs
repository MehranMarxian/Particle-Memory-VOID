/**
 * Generates demo sources into public/samples/:
 *   void-figure.png — procedural monochrome "figure" for image-sampling demos
 *   void-cloud.ply  — binary little endian point cloud (galaxy disc + bulge)
 *
 * Run: node scripts/make-samples.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- The "figure": sphere, ring, band, vignette ----------
const S = 512;
const rgba = Buffer.alloc(S * S * 4);
const set = (x, y, v, a = 255) => {
  const i = (y * S + x) * 4;
  rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = Math.min(255, v * 1.05); rgba[i + 3] = a;
};
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const nx = (x - S / 2) / (S / 2);
    const ny = (y - S / 2) / (S / 2);
    let v = 8;
    // Head: shaded sphere.
    const hx = nx - 0.05, hy = ny + 0.42;
    const hd = Math.hypot(hx, hy);
    if (hd < 0.5) {
      const light = Math.max(0, 1 - Math.hypot(hx + 0.22, hy + 0.18) / 0.75);
      v = Math.max(v, 30 + 215 * Math.pow(light, 1.6));
    }
    // Shoulders: broad arc.
    const sy = ny - 0.35;
    const sd = Math.hypot(nx / 1.7, sy / 1.15);
    if (sd < 0.62 && ny > -0.05) {
      const light = Math.max(0, 1 - sd / 0.75);
      v = Math.max(v, 20 + 160 * light * light);
    }
    // Halo ring.
    const rd = Math.hypot(nx, ny);
    const ring = Math.exp(-Math.pow((rd - 0.78) / 0.045, 2));
    v = Math.max(v, 120 * ring + 20 * Math.exp(-Math.pow((rd - 0.9) / 0.1, 2)));
    // Diagonal band.
    const band = Math.exp(-Math.pow((nx + ny * 0.8 + 0.15) / 0.09, 2));
    v = Math.max(v, 90 * band);
    set(x, y, Math.min(255, v));
  }
}
mkdirSync("public/samples", { recursive: true });
writeFileSync("public/samples/void-figure.png", encodePng(S, S, rgba));

// ---------- Point cloud: binary LE PLY, galaxy disc + bulge ----------
const N = 24000;
const recSize = 4 * 3 + 1 * 3 + 4 * 3; // xyz float32 + rgb uchar + nxyz float32
const body = Buffer.alloc(N * recSize);
let seed = 123456789;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
let o = 0;
for (let i = 0; i < N; i++) {
  let px, py, pz, shade;
  if (i < N * 0.25) {
    // Central bulge.
    const r = 0.7 * Math.cbrt(rnd());
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(2 * rnd() - 1);
    px = r * Math.sin(ph) * Math.cos(th);
    py = r * Math.cos(ph) * 0.8;
    pz = r * Math.sin(ph) * Math.sin(th);
    shade = 200 + rnd() * 55;
  } else {
    // Disc with spiral arms.
    const arm = i % 2;
    const t = rnd();
    const r = 0.6 + t * 4.4;
    const th = t * 5.5 + arm * Math.PI + (rnd() - 0.5) * 0.7;
    px = r * Math.cos(th) + (rnd() - 0.5) * 0.24;
    pz = r * Math.sin(th) + (rnd() - 0.5) * 0.24;
    py = (rnd() - 0.5) * 0.34 * Math.exp(-r / 3);
    shade = 90 + 160 * (1 - t) + rnd() * 40;
  }
  const mag = Math.hypot(px, py, pz) || 1;
  body.writeFloatLE(px, o);
  body.writeFloatLE(py, o + 4);
  body.writeFloatLE(pz, o + 8);
  body[o + 12] = Math.min(255, shade);
  body[o + 13] = Math.min(255, shade * 0.97);
  body[o + 14] = Math.min(255, shade * 1.06);
  body.writeFloatLE(px / mag, o + 15);
  body.writeFloatLE(py / mag, o + 19);
  body.writeFloatLE(pz / mag, o + 23);
  o += recSize;
}
const header = `ply
format binary_little_endian 1.0
comment VOID / PARTICLE MEMORY demo cloud
element vertex ${N}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float nx
property float ny
property float nz
end_header
`;
writeFileSync("public/samples/void-cloud.ply", Buffer.concat([Buffer.from(header, "latin1"), body]));
console.log("samples written to public/samples/");
