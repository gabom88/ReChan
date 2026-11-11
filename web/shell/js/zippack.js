// zippack.js — imports a media pack made by tools/media_pack/make_rechan_pack.py
// (experimental mode). Reads the ZIP in place with File.slice(): media
// entries are stored uncompressed, so they become Blobs without copying;
// the rest is inflated with the browser's DecompressionStream.
'use strict';

const RechanZipPack = (() => {
  const FORMAT = 'rechan-media-pack';
  class PackError extends Error {}

  async function bytes(file, start, end) {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  async function readDirectory(file) {
    const tailSize = Math.min(file.size, 65536 + 22);
    const tail = await bytes(file, file.size - tailSize, file.size);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new PackError('notZip');
    const count = u16(tail, eocd + 10);
    const cdSize = u32(tail, eocd + 12);
    const cdOffset = u32(tail, eocd + 16);
    if (count === 0xFFFF || cdOffset === 0xFFFFFFFF) throw new PackError('zip64');
    const cd = await bytes(file, cdOffset, cdOffset + cdSize);
    const entries = [];
    let p = 0;
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new PackError('badZip');
      const method = u16(cd, p + 10);
      const compSize = u32(cd, p + 20);
      const size = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      const localOffset = u32(cd, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, size, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryBlob(file, e) {
    const lh = await bytes(file, e.localOffset, e.localOffset + 30);
    if (u32(lh, 0) !== 0x04034b50) throw new PackError('badZip');
    const start = e.localOffset + 30 + u16(lh, 26) + u16(lh, 28);
    const raw = file.slice(start, start + e.compSize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new PackError('badZip');
    if (typeof DecompressionStream === 'undefined') throw new PackError('noInflate');
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).blob();
  }

  /** Imports `file` into RechanStore. onProgress({done,total,current}). */
  async function importPack(file, onProgress) {
    const entries = await readDirectory(file);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    if (!manifestEntry) throw new PackError('notPack');
    let manifest;
    try { manifest = JSON.parse(await (await entryBlob(file, manifestEntry)).text()); }
    catch (_) { throw new PackError('notPack'); }
    if (manifest.format !== FORMAT || !(manifest.version >= 1)) throw new PackError('notPack');
    if (manifest.version > 2) throw new PackError('newerPack');
    if (manifest.serial !== RechanExtractor.EXPECTED_SERIAL) throw new PackError('wrongSerial');

    const wanted = entries.filter((e) => !e.name.endsWith('/') &&
      (e.name.startsWith('assets/') || e.name.startsWith('media/')));
    const total = wanted.reduce((a, e) => a + e.size, 0);
    await RechanStore.clear();
    let done = 0;
    let batch = [];
    let batchBytes = 0;
    for (const e of wanted) {
      const key = e.name.startsWith('assets/') ? e.name.slice(7) : e.name;
      onProgress && onProgress({ done, total, current: key });
      batch.push({ key: key.toLowerCase(), data: await entryBlob(file, e) });
      batchBytes += e.size;
      done += e.size;
      if (batchBytes > 24 * 1024 * 1024 || batch.length >= 400) {
        await RechanStore.putMany(batch);
        batch = []; batchBytes = 0;
      }
    }
    // v2: identical files are stored once in the ZIP; recreate the copies.
    const byName = new Map(entries.map((e) => [e.name, e]));
    const aliases = Object.entries(manifest.aliases || {});
    for (const [alias, source] of aliases) {
      const src = byName.get(source);
      if (!src || !(alias.startsWith('assets/') || alias.startsWith('media/'))) continue;
      const key = alias.startsWith('assets/') ? alias.slice(7) : alias;
      batch.push({ key: key.toLowerCase(), data: await entryBlob(file, src) });
      if (batch.length >= 400) { await RechanStore.putMany(batch); batch = []; }
    }
    if (batch.length) await RechanStore.putMany(batch);
    const meta = {
      serial: manifest.serial,
      source: 'zip',
      files: wanted.length + aliases.length,
      bytes: total,
      media: manifest.media || {},
      extractedAt: new Date().toISOString(),
      formatVersion: 1,
    };
    await RechanStore.setMeta(meta);
    onProgress && onProgress({ done: total, total });
    return meta;
  }

  return { importPack, PackError };
})();
