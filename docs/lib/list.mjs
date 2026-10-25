const normalize = (s) => s.normalize("NFKC").toLocaleLowerCase("ja");
function filesInCategory(files, category) {
  return files.filter((f) => (f.category === undefined ? "characters" : f.category) === category);
}
function visibleFiles(files, query, key, ascending) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return files.filter((f) => words.every((w) => normalize(`${f.name} ${f.filename}`).includes(w))).sort((a, b) => {
    const x = a[key], y = b[key];
    const result = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ja", { numeric: true });
    return (ascending ? result : -result) || a.id.localeCompare(b.id);
  });
}
function selectVisible(selected, files, checked) {
  for (const file of files) checked ? selected.add(file.id) : selected.delete(file.id);
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${(n / 1024 ** index).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
export {
  filesInCategory,
  formatBytes,
  selectVisible,
  visibleFiles
};
