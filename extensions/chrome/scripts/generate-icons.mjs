import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
}

const crcTable = createCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const toCrc = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(toCrc), 8 + len);
  return chunk;
}

function generatePng(size) {
  // RGBA pixels
  const rawData = Buffer.alloc(size * (1 + size * 4)); // 1 filter byte per scanline
  let offset = 0;
  
  // Center coordinates
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  for (let y = 0; y < size; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Green rounded badge
      if (Math.abs(dx) <= r && Math.abs(dy) <= r) {
        // Inner white glyph (circle in center)
        const innerDist = Math.sqrt(dx * dx + dy * dy);
        if (innerDist <= size * 0.15) {
          rawData[offset++] = 255; // R
          rawData[offset++] = 255; // G
          rawData[offset++] = 255; // B
          rawData[offset++] = 255; // A
        } else if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= size * 0.08 && dist <= size * 0.35) {
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = 230;
        } else {
          rawData[offset++] = 5;   // #059669
          rawData[offset++] = 150;
          rawData[offset++] = 105;
          rawData[offset++] = 255;
        }
      } else {
        // Transparent outside
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflateSync(rawData));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

async function main() {
  const iconsDir = join(process.cwd(), 'extensions', 'chrome', 'icons');
  await mkdir(iconsDir, { recursive: true });

  for (const size of [16, 48, 128]) {
    const png = generatePng(size);
    await writeFile(join(iconsDir, `icon${size}.png`), png);
    console.log(`Generated icon${size}.png (${png.length} bytes)`);
  }
}

main().catch(console.error);
