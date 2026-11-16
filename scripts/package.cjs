const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const target = path.join('dist', manifest.id);
const files = ['main.js', 'manifest.json', 'styles.css', 'README.md', 'README.en.md', 'README.zh-CN.md', 'LICENSE'].sort();
fs.mkdirSync(target, { recursive: true });
for (const file of files) fs.copyFileSync(file, path.join(target, file));

// A small uncompressed ZIP writer keeps packaging dependency-free on every OS.
// Sorted entries, UTF-8 names, and a fixed DOS timestamp make equal inputs
// produce byte-identical archives. All entries live under the plugin ID.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const localParts = [];
const directoryParts = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(`${manifest.id}/${file}`, 'utf8');
  const bytes = fs.readFileSync(path.join(target, file));
  const crc = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0x2821, 12); // 2000-01-01 00:00:00
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, bytes);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0x2821, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  directoryParts.push(central, name);
  offset += local.length + name.length + bytes.length;
}
const directory = Buffer.concat(directoryParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = `${manifest.id}-${manifest.version}.zip`;
fs.writeFileSync(path.join('dist', archive), Buffer.concat([...localParts, directory, end]));

const assets = ['main.js', 'manifest.json', 'styles.css', 'LICENSE'];
for (const file of assets) fs.copyFileSync(file, path.join('dist', file));
const sums = [...assets, archive].map((file) => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join('dist', file))).digest('hex');
  return `${digest}  ${file}`;
}).join('\n') + '\n';
fs.writeFileSync(path.join('dist', 'SHA256SUMS.txt'), sums);
console.log(`Installable folder: ${target}`);
console.log(`Installable ZIP: dist/${archive}`);
