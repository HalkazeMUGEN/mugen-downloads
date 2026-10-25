import { makeZip, predictLength } from "../vendor/client-zip.mjs";
function entryNames(files) {
  const used = /* @__PURE__ */ new Set();
  return files.map((file) => {
    let stem = file.filename.normalize("NFC").replace(/\.zip$/i, "").replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80);
    if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `file_${stem || "download"}`;
    let name = `${stem}.zip`, suffix = 2;
    while (used.has(name.toLocaleLowerCase("en-US"))) name = `${stem} (${suffix++}).zip`;
    used.add(name.toLocaleLowerCase("en-US"));
    return name;
  });
}
function bundleSize(files) {
  const names = entryNames(files);
  return predictLength(files.map((f, i) => ({ name: names[i], size: f.size })));
}
function canSaveInMemory(files, limitMiB) {
  return bundleSize(files) <= BigInt(Math.floor(limitMiB * 1024 * 1024));
}
function bundleStream(files, workerUrl, signal, report = () => {
}, fetcher = fetch) {
  const names = entryNames(files);
  const progress = { bytes: 0, completed: 0, total: files.length, current: "" };
  async function* entries() {
    for (let i = 0; i < files.length; i++) {
      signal.throwIfAborted();
      const file = files[i];
      const label = `${file.name} (${file.filename})`;
      progress.current = label;
      report({ ...progress });
      let response;
      try {
        response = await fetcher(`${workerUrl}/assets/${file.id}`, { signal, credentials: "omit", redirect: "error" });
      } catch (e) {
        signal.throwIfAborted();
        throw new Error(`${label}: 通信に失敗しました`, { cause: e });
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`${label}: HTTP ${response.status}。一覧を再読み込みするか、個別DLをお試しください`);
      }
      const reader = response.body.getReader();
      // The catalog size is only a snapshot. Validate the actual response length as well as the ZIP end record.
      const length = response.headers.get('content-length');
      const expected = length !== null && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) ? Number(length) : null;
      let received = 0;
      const abort = () => {
        void reader.cancel(signal.reason).catch(() => {
        });
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      async function* chunks() {
        const signature = [];
        let tail = new Uint8Array(0);
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            received += value.byteLength;
            if (expected !== null && received > expected) throw new Error("取得先が示すサイズを超えています");
            for (const b of value.subarray(0, Math.max(0, 4 - signature.length))) signature.push(b);
            if (signature.length === 4 && !(signature[0] === 80 && signature[1] === 75 && (signature[2] === 3 && signature[3] === 4 || signature[2] === 5 && signature[3] === 6))) throw new Error("ZIP形式ではありません");
            // Keep only the maximum ZIP end record + comment, including ZIP64 archives.
            // This also detects a cleanly truncated response without Content-Length.
            if (value.length >= 65557) tail = value.slice(-65557);
            else {
              const keep = tail.subarray(Math.max(0, tail.length + value.length - 65557));
              const next = new Uint8Array(keep.length + value.length);
              next.set(keep); next.set(value, keep.length); tail = next;
            }
            progress.bytes += value.byteLength;
            report({ ...progress });
            yield value;
          }
          if ((expected !== null && received !== expected) || signature.length < 4) throw new Error("ファイルが途中で切れたか、取得先のサイズと一致しません");
          let complete = false;
          for (let j = tail.length - 22; j >= 0; j--) {
            if (tail[j] === 80 && tail[j+1] === 75 && tail[j+2] === 5 && tail[j+3] === 6 &&
              j + 22 + tail[j+20] + tail[j+21] * 256 === tail.length) { complete = true; break; }
          }
          if (!complete) throw new Error("ZIPの終端を確認できません。途中で切れた可能性があります");
          progress.completed++;
          report({ ...progress });
        } catch (e) {
          signal.throwIfAborted();
          throw new Error(`${label}: ${e instanceof Error ? e.message : "取得失敗"}`, { cause: e });
        } finally {
          signal.removeEventListener("abort", abort);
          await reader.cancel().catch(() => {
          });
          reader.releaseLock();
        }
      }
      const modified = response.headers.get('last-modified');
      yield { name: names[i], lastModified: modified && Number.isFinite(Date.parse(modified)) ? new Date(modified) : new Date(), input: chunks() };
    }
  }
  return makeZip(entries());
}
async function saveToWritable(stream, writable, signal) {
  await stream.pipeTo(writable, { signal });
}
async function saveToBlob(stream, limitMiB, signal) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > limitMiB * 1024 * 1024) throw new Error("メモリ保存の上限を超えました。選択数を減らすか個別DLをご利用ください");
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: "application/zip" });
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
export {
  bundleSize,
  bundleStream,
  canSaveInMemory,
  entryNames,
  saveToBlob,
  saveToWritable
};
