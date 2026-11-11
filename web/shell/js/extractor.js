// extractor.js — pulls ReChan's assets out of the user's own disc image,
// entirely inside the browser. The .bin/.iso is read in place with
// File.slice(): it is never uploaded anywhere and never copied whole into
// memory. Only the files ReChan needs are kept (the same whitelist as
// src/extra/psxdiscextractor.cpp and tools/extract_assets/extract_psx_bin.py),
// stored in IndexedDB by RechanStore. After that the disc image is no longer
// needed.
'use strict';

const RechanExtractor = (() => {
  const EXPECTED_SERIAL = 'SLUS-00684';

  const LAYOUTS = [
    { name: '2048',       sectorSize: 2048, dataOffset: 0,  raw: null },
    { name: '2352_mode1', sectorSize: 2352, dataOffset: 16, raw: '2352' },
    { name: '2352_xa',    sectorSize: 2352, dataOffset: 24, raw: '2352' },
    { name: '2336_xa',    sectorSize: 2336, dataOffset: 8,  raw: '2336' },
  ];

  const WHITELIST_DIRS = new Set(['fe', 'rchars', 'rtarget', 'scr', 'sound', 'tim', 'xc']);
  const WHITELIST_ROOT_FILES = new Set([
    'license.tim', 'license_data.dat', 'loadanim.con',
    'postdemo.tim', 'predemo.tim', 'runfirst.tim',
  ]);

  const MAX_SLICE = 8 * 1024 * 1024;     // bytes read from the image per slice
  const FLUSH_BYTES = 24 * 1024 * 1024;  // pending bytes before writing to IndexedDB

  class ExtractError extends Error {}

  async function readBytes(file, offset, length) {
    const buf = await file.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buf);
  }

  function u32(d, o) {
    return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  }

  function isPvd(b) {
    return b.length >= 7 && b[0] === 1 && b[1] === 0x43 && b[2] === 0x44 &&
      b[3] === 0x30 && b[4] === 0x30 && b[5] === 0x31 && b[6] === 1; // "CD001"
  }

  async function detectLayout(file) {
    for (const layout of LAYOUTS) {
      const off = 16 * layout.sectorSize + layout.dataOffset;
      if (off + 2048 > file.size) continue;
      if (isPvd(await readBytes(file, off, 2048))) return layout;
    }
    throw new ExtractError('No se reconoce el formato de la imagen (¿es un .bin/.iso de PlayStation?).');
  }

  // Logical (2048-byte user data) read of `size` bytes starting at `lba`,
  // returned as an array of Uint8Array chunks.
  async function readLogical(file, layout, lba, size) {
    const blocks = Math.ceil(size / 2048);
    const chunks = [];
    let remaining = size;
    const blocksPerSlice = Math.max(1, Math.floor(MAX_SLICE / layout.sectorSize));
    for (let b = 0; b < blocks; b += blocksPerSlice) {
      const n = Math.min(blocksPerSlice, blocks - b);
      const raw = await readBytes(file, (lba + b) * layout.sectorSize, n * layout.sectorSize);
      if (layout.sectorSize === 2048) {
        const take = Math.min(remaining, raw.length);
        chunks.push(raw.subarray(0, take));
        remaining -= take;
      } else {
        for (let i = 0; i < n && remaining > 0; i++) {
          const start = i * layout.sectorSize + layout.dataOffset;
          const take = Math.min(2048, remaining);
          chunks.push(raw.slice(start, start + take));
          remaining -= take;
        }
      }
    }
    return chunks;
  }

  function concat(chunks) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // .str movies keep their raw 2336-byte XA sectors so the interleaved audio
  // survives (matches IsoReader::ReadExtentRawXa2336BySectorCount).
  async function readRawXa(file, layout, lba, sectorCount) {
    const chunks = [];
    const perSlice = Math.max(1, Math.floor(MAX_SLICE / layout.sectorSize));
    for (let s = 0; s < sectorCount; s += perSlice) {
      const n = Math.min(perSlice, sectorCount - s);
      const raw = await readBytes(file, (lba + s) * layout.sectorSize, n * layout.sectorSize);
      if (layout.raw === '2336') {
        chunks.push(raw);
      } else {
        for (let i = 0; i < n; i++) {
          const start = i * 2352 + 16;
          chunks.push(raw.slice(start, start + 2336));
        }
      }
    }
    return chunks;
  }

  function safeLowerName(name) {
    const semi = name.indexOf(';');
    if (semi >= 0) name = name.substring(0, semi);
    return name.replace(/\s+$/, '').toLowerCase();
  }

  function parseDirRecords(data, parentParts) {
    const out = [];
    let i = 0;
    while (i < data.length) {
      const len = data[i];
      if (len === 0) {
        const next = (Math.floor(i / 2048) + 1) * 2048;
        if (next <= i) break;
        i = next;
        continue;
      }
      if (i + len > data.length || len < 34) break;
      const extentLba = u32(data, i + 2);
      const size = u32(data, i + 10);
      const flags = data[i + 25];
      const idLen = data[i + 32];
      if (33 + idLen > len) { i += len; continue; }
      if (idLen === 1 && (data[i + 33] === 0 || data[i + 33] === 1)) { i += len; continue; }
      let name = '';
      for (let k = 0; k < idLen; k++) name += String.fromCharCode(data[i + 33 + k]);
      out.push({
        parts: parentParts.concat([safeLowerName(name)]),
        isDir: (flags & 2) !== 0,
        lba: extentLba,
        size,
      });
      i += len;
    }
    return out;
  }

  async function walk(file, layout, dir, all, depth) {
    if (depth > 16) return;
    const data = concat(await readLogical(file, layout, dir.lba, dir.size));
    for (const child of parseDirRecords(data, dir.parts)) {
      all.push(child);
      if (child.isDir) await walk(file, layout, child, all, depth + 1);
    }
  }

  function normalizeSerial(name) {
    const semi = name.indexOf(';');
    if (semi >= 0) name = name.substring(0, semi);
    let out = '';
    for (const c of name) {
      if (c === '.') continue;
      out += c === '_' ? '-' : c.toUpperCase();
    }
    return out;
  }

  async function readSerial(file, layout, entries) {
    const cnf = entries.find((e) => !e.isDir && e.parts.length === 1 && e.parts[0] === 'system.cnf');
    if (!cnf) return null;
    const text = new TextDecoder('latin1').decode(concat(await readLogical(file, layout, cnf.lba, cnf.size)));
    const m = /boot\s*=\s*([^\r\n]*)/i.exec(text);
    if (!m) return null;
    const value = m[1].trim();
    const sep = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'), value.lastIndexOf(':'));
    const bootName = (sep >= 0 ? value.substring(sep + 1) : value).trim();
    return bootName ? normalizeSerial(bootName) : null;
  }

  function shouldExtract(parts) {
    if (parts.length === 0) return false;
    if (parts.length === 1) return WHITELIST_ROOT_FILES.has(parts[0]);
    return WHITELIST_DIRS.has(parts[0]);
  }

  /**
   * Extracts the whitelisted assets from `file` (a File/Blob) into RechanStore.
   * onProgress({ phase, done, total, current }) is called as work advances.
   */
  async function extract(file, onProgress) {
    const report = (p) => { try { onProgress && onProgress(p); } catch (_) { /* ignore */ } };
    report({ phase: 'scan', done: 0, total: 1 });

    const layout = await detectLayout(file);
    const pvd = concat(await readLogical(file, layout, 16, 2048));
    if (pvd[156] < 34) throw new ExtractError('Directorio raíz inválido en la imagen.');
    const root = { parts: [], isDir: true, lba: u32(pvd, 158), size: u32(pvd, 166) };

    const all = [];
    await walk(file, layout, root, all, 0);

    const serial = await readSerial(file, layout, all);
    if (!serial) {
      throw new ExtractError('No se pudo verificar la versión del disco (SYSTEM.CNF no encontrado).');
    }
    if (serial !== EXPECTED_SERIAL) {
      throw new ExtractError(`Disco incorrecto (${serial}). ReChan solo admite la versión NTSC-U (${EXPECTED_SERIAL}); las versiones PAL y de otras regiones no son compatibles.`);
    }

    const filesSorted = all.filter((e) => !e.isDir).sort((a, b) => a.lba - b.lba);
    const nextLba = filesSorted.map((e, i) => (i + 1 < filesSorted.length)
      ? filesSorted[i + 1].lba
      : e.lba + Math.max(Math.ceil(e.size / 2048), 1));

    const jobs = [];
    let total = 0;
    filesSorted.forEach((e, i) => {
      if (!shouldExtract(e.parts)) return;
      const rawXa = layout.raw !== null && e.parts[e.parts.length - 1].endsWith('.str');
      const sectors = nextLba[i] - e.lba;
      const bytes = rawXa ? sectors * 2336 : e.size;
      jobs.push({ e, rawXa, sectors, bytes });
      total += bytes;
    });
    if (jobs.length === 0) throw new ExtractError('La imagen no contiene los archivos esperados del juego.');

    await RechanStore.clear();

    let done = 0;
    let pending = [];
    let pendingBytes = 0;
    const flush = async () => {
      if (pending.length === 0) return;
      await RechanStore.putMany(pending);
      pending = [];
      pendingBytes = 0;
    };

    for (const job of jobs) {
      const key = job.e.parts.join('/');
      report({ phase: 'extract', done, total, current: key });
      const chunks = job.rawXa
        ? await readRawXa(file, layout, job.e.lba, job.sectors)
        : await readLogical(file, layout, job.e.lba, job.e.size);
      const blob = new Blob(chunks);
      pending.push({ key, data: blob });
      pendingBytes += blob.size;
      done += job.bytes;
      if (pendingBytes >= FLUSH_BYTES) await flush();
    }
    await flush();

    const meta = {
      serial,
      layout: layout.name,
      files: jobs.length,
      bytes: total,
      extractedAt: new Date().toISOString(),
      formatVersion: 1,
    };
    await RechanStore.setMeta(meta);
    report({ phase: 'done', done: total, total });
    return meta;
  }

  return { extract, ExtractError, EXPECTED_SERIAL };
})();
