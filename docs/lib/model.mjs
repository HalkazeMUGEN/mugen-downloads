const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
function assetURL(repository, tag, filename) {
  if (!repositoryPattern.test(repository) || [tag, filename].some((s) => typeof s !== "string" || !s || s === "." || s === ".." || /[\u0000-\u001f\u007f]/.test(s))) {
    throw new Error("不正なリポジトリ・タグ・ファイル名です");
  }
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}
function validateConfig(c) {
  if (!c || typeof c.title !== "string" || !c.title.trim() || typeof c.description !== "string" || typeof c.workerUrl !== "string" || !Number.isFinite(c.blobLimitMiB) || c.blobLimitMiB < 1 || c.blobLimitMiB > 500) throw new Error("config.json が不正です");
  if (c.workerUrl) {
    const u = new URL(c.workerUrl);
    if (u.protocol !== "https:" || u.origin !== c.workerUrl) throw new Error("workerUrl はHTTPSのoriginを指定してください");
  }
  return c;
}
function validateCatalog(value) {
  const c = value;
  if (!c || c.schemaVersion !== 1 || !Array.isArray(c.files) || !Array.isArray(c.warnings) || !c.warnings.every((s) => typeof s === "string") || c.generatedAt !== null && !Number.isFinite(Date.parse(c.generatedAt))) throw new Error("一覧データの形式が不正です");
  const ids = /* @__PURE__ */ new Set();
  for (const f of c.files) {
    if (f && f.category !== undefined && !["characters", "other"].includes(f.category)) throw new Error("配布ファイルの分類が不正です");
    if (!f || typeof f.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(f.id) || ids.has(f.id) || typeof f.characterId !== "string" || typeof f.name !== "string" || typeof f.repository !== "string" || typeof f.tag !== "string" || typeof f.filename !== "string" || !f.filename.toLowerCase().endsWith(".zip") || !Number.isSafeInteger(f.size) || f.size <= 0 || !Number.isFinite(Date.parse(f.updatedAt)) || f.downloadUrl !== assetURL(f.repository, f.tag, f.filename) || f.releaseUrl !== `https://github.com/${f.repository}/releases/tag/${encodeURIComponent(f.tag)}`) throw new Error("配布ファイルの情報が不正です");
    ids.add(f.id);
  }
  return c;
}
export {
  assetURL,
  repositoryPattern,
  validateCatalog,
  validateConfig
};
