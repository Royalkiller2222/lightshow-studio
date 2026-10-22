// Renders the logo (src/ui/logo.js) into the app + installer icons:
//   build/icon.ico      16–256 px (16–32 px use the bolder 3-beam cut)
//   build/icon.png      512 px (electron-builder / README)
//   src/assets/icon.png 256 px (window + taskbar icon when running from source)
//
// Run after changing the logo:  npm run icons
// Uses Electron's own Chromium to rasterise the SVG — no image libraries.
// Sizes below 256 are stored as 32-bit BMP entries and 256 as PNG (the classic
// Vista icon layout), which every Windows tool, including NSIS, accepts.

'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const SMALL_MAX = 32;

// Runs inside the hidden page: import the logo module, draw each size.
async function renderInPage(logoSource, sizes, smallMax) {
  const url = URL.createObjectURL(new Blob([logoSource], { type: 'text/javascript' }));
  const { logoSvg } = await import(url);
  const draw = (svg, size) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      resolve({
        size,
        png: c.toDataURL('image/png').split(',')[1],
        rgba: size < 256 ? Array.from(ctx.getImageData(0, 0, size, size).data) : null,
      });
    };
    img.onerror = () => reject(new Error(`logo SVG failed to render at ${size}px`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const out = [];
  for (const s of [...sizes, 512]) {
    out.push(await draw(logoSvg({ small: s <= smallMax, size: s, id: `i${s}` }), s));
  }
  return { images: out, master: logoSvg({ size: 1024, id: 'master' }) };
}

/** 32-bit BMP (DIB) icon entry: BITMAPINFOHEADER + bottom-up BGRA + empty AND mask. */
function dibEntry(size, rgba) {
  const maskRow = ((size + 31) >> 5) << 2;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);            // biSize
  header.writeInt32LE(size, 4);           // biWidth
  header.writeInt32LE(size * 2, 8);       // biHeight (XOR + AND masks)
  header.writeUInt16LE(1, 12);            // biPlanes
  header.writeUInt16LE(32, 14);           // biBitCount
  header.writeUInt32LE(0, 16);            // BI_RGB
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // bottom-up rows
    for (let x = 0; x < size; x++) {
      const i = src + x * 4, o = (y * size + x) * 4;
      pixels[o] = rgba[i + 2]; pixels[o + 1] = rgba[i + 1]; pixels[o + 2] = rgba[i]; pixels[o + 3] = rgba[i + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function buildIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt16LE(1, o + 4);   // planes
    dir.writeUInt16LE(32, o + 6);  // bits per pixel
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>');
    const logoSource = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'logo.js'), 'utf8');
    const { images, master } = await win.webContents.executeJavaScript(
      `(${renderInPage.toString()})(${JSON.stringify(logoSource)}, ${JSON.stringify(ICO_SIZES)}, ${SMALL_MAX})`);

    const bySize = Object.fromEntries(images.map((im) => [im.size, im]));
    const entries = ICO_SIZES.map((s) => ({
      size: s,
      data: s >= 256 ? Buffer.from(bySize[s].png, 'base64') : dibEntry(s, bySize[s].rgba),
    }));
    fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
    fs.mkdirSync(path.join(ROOT, 'src', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(entries));
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), Buffer.from(bySize[512].png, 'base64'));
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.svg'), master);
    fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon.png'), Buffer.from(bySize[256].png, 'base64'));
    console.log(`icons written: build/icon.ico (${ICO_SIZES.join(', ')} px), build/icon.png, build/icon.svg, src/assets/icon.png`);
    app.exit(0);
  } catch (e) {
    console.error('icon generation failed:', e);
    app.exit(1);
  }
});
