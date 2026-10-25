// Linked after Emscripten's own libraries (--js-library), so it replaces the read-only half of
// WasmFS's OPFS backend (libwasmfs_opfs.js). The game's imported archives stay in OPFS and are read
// in place (docs/web/storage.md, "How the game reads its files"); the stock backend reads each one
// through Blob.slice().arrayBuffer(), a promise and a copy for every read() the game makes.
//
// A file opened for reading takes a read-only sync access handle where the browser has one
// (Chrome's `mode: 'read-only'` takes a shared lock, so the same archive opens any number of times):
// a read is then a plain call into the handle. Where it does not (another mode of the same file is
// open, or the browser has no such mode) the file is read as a Blob, through a small block cache so a
// run of small reads is one slice. Writes still go through the stock access-handle path.
//
// The game opens and closes the same archive hundreds of times while it starts (about 4 ms each for
// createSyncAccessHandle), so a read-only handle is kept open after the last close and handed to the
// next open of that file. It is released when the file is freed or when too many sit idle.

addToLibrary({
  // blob id + ':' + block index -> Uint8Array, least recently used first
  $ra2OpfsBlocks: '{blocks: new Map(), bytes: 0, blockSize: 256 * 1024, maxBytes: 8 * 1024 * 1024}',
  // file id -> {access, size, name, refs}: read-only handles kept open between opens
  $ra2OpfsHandles: '{files: new Map(), idleLimit: 24}',
  // access id -> read counters for WasmFS's normal sync-access path
  $ra2OpfsAccessStats: 'new Map()',
  // read path + filename -> counters across short-lived WasmFS handles
  $ra2OpfsReadTotals: 'new Map()',
  $ra2OpfsRecordRead__deps: ['$ra2OpfsReadTotals'],
  $ra2OpfsRecordRead: (mode, name, nread, readMs, pos, len) => {
    const key = `${mode}:${name}`;
    let total = ra2OpfsReadTotals.get(key);
    if (!total) {
      total = {reads: 0, bytes: 0, readMs: 0, minPos: Infinity, maxEnd: 0};
      ra2OpfsReadTotals.set(key, total);
    }
    total.reads++;
    if (nread > 0) total.bytes += nread;
    total.readMs += readMs;
    total.minPos = Math.min(total.minPos, pos);
    total.maxEnd = Math.max(total.maxEnd, pos + len);
    if (total.reads === 1 || total.reads % 4096 === 0) {
      err(`[opfs-read] ${mode} ${name}: ${total.reads} reads, ${total.bytes} bytes, ${total.readMs.toFixed(1)} ms in read(), range ${total.minPos}-${total.maxEnd}`);
    }
  },

  // WasmFS uses access handles for the game's ordinary file reads. Keep its original
  // in-place mode and error behavior, adding only the per-handle counters for profiling.
  $ra2OpfsOpens: '{count: 0, ms: 0}',
  _wasmfs_opfs_open_access__deps: ['$wasmfsOPFSFileHandles', '$wasmfsOPFSAccessHandles', '$wasmfsOPFSProxyFinish', '$ra2OpfsAccessStats', '$ra2OpfsOpens'],
  _wasmfs_opfs_open_access: async (ctx, fileID, accessIDPtr) => {
    const fileHandle = wasmfsOPFSFileHandles.get(fileID);
    let accessID;
    const openStarted = performance.now();
    try {
      let accessHandle;
      /** @suppress {checkTypes} */
      const len = FileSystemFileHandle.prototype.createSyncAccessHandle.length;
      if (len === 0) accessHandle = await fileHandle.createSyncAccessHandle();
      else accessHandle = await fileHandle.createSyncAccessHandle({mode: 'in-place'});
      accessID = wasmfsOPFSAccessHandles.allocate(accessHandle);
      ra2OpfsAccessStats.set(accessID, {name: fileHandle.name, reads: 0, bytes: 0, readMs: 0});
    } catch (e) {
      if (e.name === 'InvalidStateError' || e.name === 'NoModificationAllowedError') {
        accessID = -{{{ cDefs.EACCES }}};
      } else {
#if ASSERTIONS
        err('unexpected error:', e, e.stack);
#endif
        accessID = -{{{ cDefs.EIO }}};
      }
    }
    {{{ makeSetValue('accessIDPtr', 0, 'accessID', 'i32') }}};
    ra2OpfsOpens.count++;
    ra2OpfsOpens.ms += performance.now() - openStarted;
    if (ra2OpfsOpens.count % 256 === 0) {
      err(`[opfs-open] ${ra2OpfsOpens.count} opens, ${ra2OpfsOpens.ms.toFixed(0)} ms in createSyncAccessHandle`);
    }
    wasmfsOPFSProxyFinish(ctx);
  },

  _wasmfs_opfs_close_access__deps: ['$wasmfsOPFSAccessHandles', '$wasmfsOPFSProxyFinish', '$ra2OpfsAccessStats'],
  _wasmfs_opfs_close_access: async (ctx, accessID, errPtr) => {
    const accessHandle = wasmfsOPFSAccessHandles.get(accessID);
    try {
      await accessHandle.close();
    } catch {
      const error = -{{{ cDefs.EIO }}};
      {{{ makeSetValue('errPtr', 0, 'error', 'i32') }}};
    }
    ra2OpfsAccessStats.delete(accessID);
    wasmfsOPFSAccessHandles.free(accessID);
    wasmfsOPFSProxyFinish(ctx);
  },

  _wasmfs_opfs_read_access__i53abi: true,
  _wasmfs_opfs_read_access__deps: ['$wasmfsOPFSAccessHandles', '$ra2OpfsAccessStats', '$ra2OpfsRecordRead'],
  _wasmfs_opfs_read_access: (accessID, bufPtr, len, pos) => {
    const accessHandle = wasmfsOPFSAccessHandles.get(accessID);
    const data = HEAPU8.subarray(bufPtr, bufPtr + len);
    const started = performance.now();
    let nread;
    try {
      nread = accessHandle.read(data, {at: pos});
    } catch (e) {
      if (e.name === 'TypeError') return -{{{ cDefs.EINVAL }}};
#if ASSERTIONS
      err('unexpected error:', e, e.stack);
#endif
      return -{{{ cDefs.EIO }}};
    }
    const stats = ra2OpfsAccessStats.get(accessID);
    if (stats) {
      stats.reads++;
      if (nread > 0) stats.bytes += nread;
      const readMs = performance.now() - started;
      stats.readMs += readMs;
      ra2OpfsRecordRead('access', stats.name, nread, readMs, pos, len);
    }
    return nread;
  },

  _wasmfs_opfs_open_blob__deps: ['$wasmfsOPFSFileHandles', '$wasmfsOPFSBlobs', '$wasmfsOPFSProxyFinish', '$ra2OpfsHandles'],
  _wasmfs_opfs_open_blob: async (ctx, fileID, blobIDPtr) => {
    let fileHandle = wasmfsOPFSFileHandles.get(fileID);
    let blobID;
    try {
      let reader = null;
      let entry = ra2OpfsHandles.files.get(fileID);
      if (!entry) {
        try {
          /** @suppress {checkTypes} */
          const access = await fileHandle.createSyncAccessHandle({mode: 'read-only'});
          entry = {access, size: access.getSize(), name: fileHandle.name, refs: 0, dead: false};
          const raced = ra2OpfsHandles.files.get(fileID);
          if (raced) {
            // another open of this file finished first: keep its handle
            access.close();
            entry = raced;
          } else {
            ra2OpfsHandles.files.set(fileID, entry);
          }
        } catch (e) {
          // locked for writing, or no such mode here: read it as a Blob
        }
      }
      if (entry) {
        entry.refs++;
        reader = {entry, access: entry.access, size: entry.size, name: entry.name, mode: 'sync', reads: 0, bytes: 0, readMs: 0};
      } else {
        const blob = await fileHandle.getFile();
        reader = {blob, size: blob.size, name: fileHandle.name, mode: 'blob', reads: 0, bytes: 0, readMs: 0};
      }
      blobID = wasmfsOPFSBlobs.allocate(reader);
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        blobID = -{{{ cDefs.EACCES }}};
      } else {
#if ASSERTIONS
        err('unexpected error:', e, e.stack);
#endif
        blobID = -{{{ cDefs.EIO }}};
      }
    }
    {{{ makeSetValue('blobIDPtr', 0, 'blobID', 'i32') }}};
    wasmfsOPFSProxyFinish(ctx);
  },

  $ra2OpfsRelease__deps: ['$ra2OpfsHandles'],
  $ra2OpfsRelease: (fileID, entry) => {
    if (!entry.dead) {
      // keep it open for the next open of this file; close the longest idle ones past the limit
      let idle = 0;
      for (const e of ra2OpfsHandles.files.values()) if (e.refs === 0) idle++;
      for (const [id, e] of ra2OpfsHandles.files) {
        if (idle <= ra2OpfsHandles.idleLimit) break;
        if (e.refs !== 0) continue;
        try { e.access.close(); } catch (err) { /* already closed */ }
        ra2OpfsHandles.files.delete(id);
        idle--;
      }
      return;
    }
    try { entry.access.close(); } catch (err) { /* already closed */ }
  },

  _wasmfs_opfs_free_file__deps: ['$wasmfsOPFSFileHandles', '$ra2OpfsHandles'],
  _wasmfs_opfs_free_file: (fileID) => {
    const entry = ra2OpfsHandles.files.get(fileID);
    if (entry) {
      ra2OpfsHandles.files.delete(fileID);
      if (entry.refs === 0) {
        try { entry.access.close(); } catch (e) { /* already closed */ }
      } else {
        entry.dead = true;
      }
    }
    wasmfsOPFSFileHandles.free(fileID);
  },

  _wasmfs_opfs_close_blob__deps: ['$wasmfsOPFSBlobs', '$ra2OpfsBlocks', '$ra2OpfsRelease'],
  _wasmfs_opfs_close_blob: (blobID) => {
    const reader = wasmfsOPFSBlobs.get(blobID);
    if (reader.entry) {
      reader.entry.refs--;
      if (reader.entry.refs === 0) ra2OpfsRelease(0, reader.entry);
    } else {
      const prefix = blobID + ':';
      for (const [key, block] of ra2OpfsBlocks.blocks) {
        if (!key.startsWith(prefix)) continue;
        ra2OpfsBlocks.blocks.delete(key);
        ra2OpfsBlocks.bytes -= block.length;
      }
    }
    wasmfsOPFSBlobs.free(blobID);
  },

  _wasmfs_opfs_get_size_blob__i53abi: true,
  _wasmfs_opfs_get_size_blob__deps: ['$wasmfsOPFSBlobs'],
  _wasmfs_opfs_get_size_blob: (blobID) => wasmfsOPFSBlobs.get(blobID).size,

  _wasmfs_opfs_read_blob__i53abi: true,
  _wasmfs_opfs_read_blob__deps: ['$wasmfsOPFSBlobs', '$wasmfsOPFSProxyFinish', '$ra2OpfsBlocks', '$ra2OpfsRecordRead'],
  _wasmfs_opfs_read_blob: async (ctx, blobID, bufPtr, len, pos, nreadPtr) => {
    const reader = wasmfsOPFSBlobs.get(blobID);
    const readStarted = performance.now();
    let nread = 0;

    try {
      if (reader.access) {
        nread = reader.access.read(HEAPU8.subarray(bufPtr, bufPtr + len), {at: pos});
      } else if (len >= ra2OpfsBlocks.blockSize * 4) {
        // a long read gains nothing from blocks
        const data = new Uint8Array(await reader.blob.slice(pos, pos + len).arrayBuffer());
        HEAPU8.set(data, bufPtr);
        nread = data.length;
      } else {
        const size = ra2OpfsBlocks.blockSize;
        while (nread < len && pos + nread < reader.size) {
          const at = pos + nread;
          const index = Math.floor(at / size);
          const key = blobID + ':' + index;
          let block = ra2OpfsBlocks.blocks.get(key);
          if (block) {
            ra2OpfsBlocks.blocks.delete(key);
          } else {
            block = new Uint8Array(await reader.blob.slice(index * size, (index + 1) * size).arrayBuffer());
            ra2OpfsBlocks.bytes += block.length;
            while (ra2OpfsBlocks.bytes > ra2OpfsBlocks.maxBytes && ra2OpfsBlocks.blocks.size) {
              const oldest = ra2OpfsBlocks.blocks.keys().next().value;
              ra2OpfsBlocks.bytes -= ra2OpfsBlocks.blocks.get(oldest).length;
              ra2OpfsBlocks.blocks.delete(oldest);
            }
          }
          ra2OpfsBlocks.blocks.set(key, block);
          const from = at - index * size;
          const count = Math.min(len - nread, block.length - from);
          if (count <= 0) break;
          HEAPU8.set(block.subarray(from, from + count), bufPtr + nread);
          nread += count;
        }
      }
    } catch (e) {
      if (e instanceof RangeError || e.name == 'TypeError') {
        nread = -{{{ cDefs.EFAULT }}};
      } else {
#if ASSERTIONS
        err('unexpected error:', e, e.stack);
#endif
        nread = -{{{ cDefs.EIO }}};
      }
    }

    reader.reads++;
    if (nread > 0) reader.bytes += nread;
    const readMs = performance.now() - readStarted;
    reader.readMs += readMs;
    ra2OpfsRecordRead(reader.mode, reader.name, nread, readMs, pos, len);

    {{{ makeSetValue('nreadPtr', 0, 'nread', 'i32') }}};
    wasmfsOPFSProxyFinish(ctx);
  },
});
