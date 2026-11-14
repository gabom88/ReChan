// netpack.js — "Download the game": fetches the ReChan pack published next
// to the page (data/pack.json + data/rechan-pack.partNNN, see
// tools/media_pack/split_pack.py), verifies every part with SHA-256, keeps
// the parts in their own IndexedDB so an interrupted download resumes, then
// joins them and imports the result exactly like a ZIP chosen by hand.
'use strict';

const RechanNetPack = (() => {
  const BASE = 'data/';
  const DB_NAME = 'rechan-download';
  const STORE = 'parts';

  class NetError extends Error {}

  async function info() {
    try {
      const res = await fetch(BASE + 'pack.json', { cache: 'no-store' });
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || j.format !== 'rechan-pack-parts' || !Array.isArray(j.parts) || !j.parts.length) return null;
      return j;
    } catch (_) {
      return null;
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  async function sha256Hex(buf) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Downloads one part with byte progress; returns its ArrayBuffer.
  async function fetchPart(part, onBytes) {
    const res = await fetch(BASE + part.name, { cache: 'no-store' });
    if (!res.ok) throw new NetError('http ' + res.status);
    if (!res.body || !res.body.getReader) {
      const buf = await res.arrayBuffer();
      onBytes(buf.byteLength);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      onBytes(value.byteLength);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out.buffer;
  }

  // onProgress({ phase: 'download'|'import', done, total, part, parts })
  async function downloadAndImport(pack, onProgress) {
    if (!crypto || !crypto.subtle) throw new NetError('noCrypto');
    const db = await openDb();
    try {
      // Parts kept from an earlier, interrupted download (same SHA-256 only).
      const kept = await tx(db, 'readonly', (s) => req(s.getAll()).then((rows) => rows));
      const have = new Map((kept || []).map((r) => [r.name, r]));
      const total = pack.parts.reduce((a, p) => a + p.size, 0);
      let done = 0;
      const blobs = [];
      for (let i = 0; i < pack.parts.length; i++) {
        const part = pack.parts[i];
        const old = have.get(part.name);
        if (old && old.sha256 === part.sha256 && old.blob && old.blob.size === part.size) {
          blobs.push(old.blob);
          done += part.size;
          onProgress && onProgress({ phase: 'download', done, total, part: i + 1, parts: pack.parts.length });
          continue;
        }
        let buf = null;
        for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
          const before = done;
          try {
            const b = await fetchPart(part, (n) => {
              done += n;
              onProgress && onProgress({ phase: 'download', done, total, part: i + 1, parts: pack.parts.length });
            });
            if (b.byteLength !== part.size || await sha256Hex(b) !== part.sha256) throw new NetError('badPart');
            buf = b;
          } catch (e) {
            done = before;
            if (attempt === 3) throw e instanceof NetError ? e : new NetError('network');
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        const blob = new Blob([buf]);
        await tx(db, 'readwrite', (s) => s.put({ name: part.name, sha256: part.sha256, blob }, part.name));
        blobs.push(blob);
      }

      // Joined pack (disk-backed blobs) -> the ZIP importer.
      const file = new Blob(blobs, { type: 'application/zip' });
      if (file.size !== pack.size) throw new NetError('badPart');
      const meta = await RechanZipPack.importPack(file, (p) => {
        onProgress && onProgress({ phase: 'import', done: p.done, total: p.total, current: p.current });
      });
      meta.source = 'zip';
      meta.downloaded = true;
      await RechanStore.setMeta(meta);
      // Imported: the parts are no longer needed.
      await tx(db, 'readwrite', (s) => s.clear());
      return meta;
    } finally {
      db.close();
    }
  }

  return { info, downloadAndImport, NetError };
})();
