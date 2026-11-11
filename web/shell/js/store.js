// store.js — extracted disc assets, kept in the browser (IndexedDB).
//
// One record per extracted file: key = lower-case relative path
// ("xc/lev01.lcf"), value = Blob. Blobs read back from IndexedDB are backed by
// the browser's disk storage, so holding the whole index costs almost no RAM;
// the engine pulls only the byte ranges it asks for (see p3d/fileio.cpp).
'use strict';

const RechanStore = (() => {
  const DB_NAME = 'rechan-assets';
  const DB_VERSION = 1;
  const FILES = 'files';
  const META = 'meta';

  let db = null;
  const files = new Map();   // key -> Blob
  const dirs = new Map();    // dir key ('' = root) -> Map(name -> isDir)

  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function open() {
    if (db) return db;
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    db = await req(r);
    return db;
  }

  function addToIndex(key, blob) {
    files.set(key, blob);
    const parts = key.split('/');
    let dir = '';
    for (let i = 0; i < parts.length; i++) {
      if (!dirs.has(dir)) dirs.set(dir, new Map());
      const isDir = i < parts.length - 1;
      dirs.get(dir).set(parts[i], isDir);
      dir = dir ? dir + '/' + parts[i] : parts[i];
    }
  }

  async function load() {
    await open();
    files.clear();
    dirs.clear();
    const tx = db.transaction(FILES, 'readonly');
    const store = tx.objectStore(FILES);
    await new Promise((resolve, reject) => {
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) { resolve(); return; }
        addToIndex(cursor.key, cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return files.size;
  }

  async function getMeta() {
    await open();
    return req(db.transaction(META, 'readonly').objectStore(META).get('manifest'));
  }

  async function setMeta(meta) {
    await open();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(meta, 'manifest');
    await txDone(tx);
  }

  // entries: [{ key, data: Uint8Array | Blob }]
  async function putMany(entries) {
    await open();
    const tx = db.transaction(FILES, 'readwrite');
    const store = tx.objectStore(FILES);
    for (const e of entries) {
      const blob = e.data instanceof Blob ? e.data : new Blob([e.data]);
      store.put(blob, e.key);
    }
    await txDone(tx);
  }

  async function clear() {
    await open();
    const tx = db.transaction([FILES, META], 'readwrite');
    tx.objectStore(FILES).clear();
    tx.objectStore(META).clear();
    await txDone(tx);
    files.clear();
    dirs.clear();
  }

  function normalize(path) {
    return String(path).toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/')
      .replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
  }

  // --- API used by the engine (EM_JS in p3d/fileio.cpp) ---
  const engineApi = {
    size(path) {
      const blob = files.get(normalize(path));
      return blob ? blob.size : -1;
    },
    isDir(path) {
      return dirs.has(normalize(path));
    },
    list(path) {
      const entries = dirs.get(normalize(path));
      if (!entries) return null;
      let out = '';
      for (const [name, isDir] of entries) out += name + '\t' + (isDir ? 'D' : 'F') + '\n';
      return out;
    },
    async read(path, offset, length) {
      const blob = files.get(normalize(path));
      if (!blob) return null;
      const buf = await blob.slice(offset, offset + length).arrayBuffer();
      return new Uint8Array(buf);
    },
  };

  function totalBytes() {
    let n = 0;
    for (const b of files.values()) n += b.size;
    return n;
  }

  function getBlob(path) { return files.get(normalize(path)) || null; }

  return { open, load, getMeta, setMeta, putMany, clear, engineApi, totalBytes, getBlob,
           get fileCount() { return files.size; },
           has: (k) => files.has(normalize(k)) };
})();
