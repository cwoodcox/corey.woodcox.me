#!/usr/bin/env node
// Generates public/favicon.ico from public/favicon.svg
// Embeds 16, 32, and 48px PNG frames for legacy browser fallback.
// Usage: node scripts/generate-ico.js
// Requires: sharp (already a project dep via astro)

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.resolve(__dirname, '../public/favicon.svg');
const icoPath = path.resolve(__dirname, '../public/favicon.ico');

const svg = fs.readFileSync(svgPath);
const sizes = [16, 32, 48];

Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()))
  .then(buffers => {
    const images = sizes.map((size, i) => ({ size, data: buffers[i] }));

    const headerSize = 6;
    const dirEntrySize = 16;
    const dirSize = dirEntrySize * images.length;
    let dataOffset = headerSize + dirSize;

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);

    const dir = Buffer.alloc(dirSize);
    images.forEach(({ size, data }, i) => {
      const off = i * dirEntrySize;
      dir.writeUInt8(size === 256 ? 0 : size, off);
      dir.writeUInt8(size === 256 ? 0 : size, off + 1);
      dir.writeUInt8(0, off + 2);
      dir.writeUInt8(0, off + 3);
      dir.writeUInt16LE(1, off + 4);
      dir.writeUInt16LE(32, off + 6);
      dir.writeUInt32LE(data.length, off + 8);
      dir.writeUInt32LE(dataOffset, off + 12);
      dataOffset += data.length;
    });

    const ico = Buffer.concat([header, dir, ...images.map(i => i.data)]);
    fs.writeFileSync(icoPath, ico);
    console.log(`Written ${icoPath} (${ico.length} bytes, frames: ${sizes.join(', ')}px)`);
  });
