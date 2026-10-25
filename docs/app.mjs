import { validateConfig, validateCatalog } from "./lib/model.mjs";
import { filesInCategory, visibleFiles, selectVisible, formatBytes } from "./lib/list.mjs";
import { bundleStream, saveToBlob, saveToWritable } from "./lib/bundle.mjs";
const picker = window.showSaveFilePicker?.bind(window);
const el = (id) => document.getElementById(id);
let config = { title: "Halkazeの製作物置き場", description: "MUGENキャラ製作物置き場", workerUrl: "", blobLimitMiB: 100 };
const selected = /* @__PURE__ */ new Set();
let files = [], shown = [], sort = "updatedAt", ascending = false;
let category = "characters";
const categoryLabels = { characters: "キャラクター", other: "その他" };
const listStates = {
  characters: { query: "", sort: "updatedAt", ascending: false },
  other: { query: "", sort: "updatedAt", ascending: false }
};
const categoryTabs = [...document.querySelectorAll("[data-category]")];
let previewMode = false;
let controller, blobUrl;
const search = el("search"), rows = el("rows");
const download = el("download"), all = el("select-all");
const status = el("status"), errorBox = el("error"), saveLink = el("save-blob");
const currentFiles = () => filesInCategory(files, category);
const getSelected = () => currentFiles().filter((f) => selected.has(f.id));
function updateSelection() {
  const chosen = getSelected(), bytes = chosen.reduce((n, f) => n + f.size, 0);
  el("selection").textContent = `${chosen.length}件を選択 · ${previewMode ? "合計サイズ未取得" : `参考合計 ${formatBytes(bytes)}`}`;
  const hidden = chosen.filter((f) => !shown.some((s) => s.id === f.id)).length;
  el("hidden-selection").textContent = hidden ? `検索結果に表示されていない選択: ${hidden}件（一括DLに含まれます）` : "";
  const count = shown.filter((f) => selected.has(f.id)).length;
  all.checked = shown.length > 0 && count === shown.length;
  all.indeterminate = count > 0 && count < shown.length;
  all.disabled = !shown.length;
  download.disabled = !!controller || !chosen.length || !config.workerUrl;
  el("save-hint").textContent = previewMode ? "見た目のプレビューです。検索・並べ替え・選択を確認できます。ダウンロードは公開サイトでご確認ください。" : !config.workerUrl ? "現在は個別ダウンロードをご利用いただけます。一括DLは準備中です。" : picker ? "一覧に掲載したバージョンのZIPを順番に取得します。開始時に保存先を選んでください。" : `このブラウザは実際の取得量が${config.blobLimitMiB} MiBを超えると一括DLを中止します。大きいファイルは個別DLをご利用ください。完了後に保存リンクが表示されます。`;
  for (const input of rows.querySelectorAll("input[type=checkbox]")) {
    input.checked = selected.has(input.value);
    input.closest("tr")?.classList.toggle("selected", input.checked);
  }
}
function cell(row, content) {
  const td = row.insertCell();
  typeof content === "string" ? td.textContent = content : td.append(content);
  return td;
}
function render() {
  const categoryFiles = currentFiles();
  shown = visibleFiles(categoryFiles, search.value, sort, ascending);
  for (const tab of categoryTabs) {
    const active = tab.dataset.category === category;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    el(`count-${tab.dataset.category}`).textContent = filesInCategory(files, tab.dataset.category).length;
  }
  el("download-list").setAttribute("aria-labelledby", `tab-${category}`);
  el("list-caption").textContent = `${categoryLabels[category]}の配布ファイル一覧。見出しのボタンで並べ替えられます。`;
  rows.replaceChildren();
  for (const f of shown) {
    const row = rows.insertRow(), checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = f.id;
    checkbox.setAttribute("aria-label", `${f.name} / ${f.filename} を選択`);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? selected.add(f.id) : selected.delete(f.id);
      updateSelection();
    });
    cell(row, checkbox);
    const link = document.createElement("a");
    link.href = f.releaseUrl;
    link.textContent = f.filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const filename = cell(row, link), name = document.createElement("small");
    name.textContent = f.name;
    filename.append(name);
    const version = cell(row, previewMode ? "—" : f.tag);
    version.title = previewMode ? "プレビューではタグを取得していません" : "一覧の手動更新時に取得したタグです";
    cell(row, previewMode ? "—" : formatBytes(f.size));
    const time = document.createElement("time");
    time.dateTime = f.updatedAt;
    time.textContent = new Date(f.updatedAt).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
    time.title = new Date(f.updatedAt).toLocaleString("ja-JP");
    cell(row, previewMode ? "—" : time);
    const direct = document.createElement("a");
    if (previewMode) {
      direct.setAttribute("aria-disabled", "true");
      direct.setAttribute("role", "link");
      direct.tabIndex = 0;
    }
    else direct.href = f.downloadUrl;
    direct.textContent = "DL";
    direct.className = "direct";
    direct.setAttribute("aria-label", `${f.filename} を個別ダウンロード`);
    const actions = cell(row, direct);
    const history = document.createElement('a');
    history.href = `https://github.com/${f.repository}/releases`;
    history.textContent = 'Older versions'; history.className = 'history';
    history.setAttribute('aria-label', `Older versions — ${f.name}`);
    actions.append(document.createTextNode(' '), history);
  }
  el("count").textContent = `${shown.length} / ${categoryFiles.length} ファイル`;
  el("empty").hidden = shown.length > 0;
  el("empty").textContent = categoryFiles.length ? "一致するファイルがありません。検索条件を変更してください。" : `「${categoryLabels[category]}」には現在、配布中のファイルはありません。`;
  for (const button of document.querySelectorAll("[data-sort]")) {
    const active = button.dataset.sort === sort;
    button.closest("th").setAttribute("aria-sort", active ? ascending ? "ascending" : "descending" : "none");
    button.querySelector("span").textContent = active ? ascending ? "↑" : "↓" : "↕";
  }
  updateSelection();
}
function switchCategory(next) {
  if (next === category) return;
  listStates[category] = { query: search.value, sort, ascending };
  category = next;
  search.value = listStates[category].query;
  ({ sort, ascending } = listStates[category]);
  render();
}
categoryTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => switchCategory(tab.dataset.category));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % categoryTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + categoryTabs.length) % categoryTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = categoryTabs.length - 1;
    else return;
    event.preventDefault();
    switchCategory(categoryTabs[next].dataset.category);
    categoryTabs[next].focus();
  });
});
search.addEventListener("input", render);
document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
  const next = button.dataset.sort;
  ascending = next === sort ? !ascending : next === "filename";
  sort = next;
  render();
}));
all.addEventListener("change", () => {
  selectVisible(selected, shown, all.checked);
  updateSelection();
});
el("select-visible").addEventListener("click", () => {
  selectVisible(selected, shown, true);
  updateSelection();
});
el("clear-visible").addEventListener("click", () => {
  selectVisible(selected, shown, false);
  updateSelection();
});
el("clear-all").addEventListener("click", () => {
  selectVisible(selected, currentFiles(), false);
  updateSelection();
});
el("cancel").addEventListener("click", () => controller?.abort());
window.addEventListener("beforeunload", (event) => {
  if (controller) {
    event.preventDefault();
    event.returnValue = "";
  }
});
download.addEventListener("click", async () => {
  if (controller) return;
  const chosen = getSelected();
  if (!chosen.length || !config.workerUrl) return;
  const archiveName = category === "characters" ? "SelectedCharacters.zip" : "SelectedOthers.zip";
  controller = new AbortController();
  const active = controller;
  errorBox.hidden = true;
  saveLink.hidden = true;
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = void 0;
  }
  el("progress-box").hidden = false;
  const progress = el("progress");
  progress.max = chosen.length;
  progress.value = 0;
  status.textContent = picker ? "保存先を選択してください…" : "ダウンロードを開始しています…";
  updateSelection();
  let writable;
  try {
    if (picker) {
      const handle = await picker({ suggestedName: archiveName, types: [{ description: "ZIPファイル", accept: { "application/zip": [".zip"] } }] });
      active.signal.throwIfAborted();
      writable = await handle.createWritable();
    }
    active.signal.throwIfAborted();
    let last = 0;
    const stream = bundleStream(chosen, config.workerUrl, active.signal, (p) => {
      const now = performance.now();
      if (now - last < 100 && p.completed !== p.total) return;
      last = now;
      progress.value = p.completed;
      status.textContent = `取得済み ${p.completed} / ${p.total}件 · ${formatBytes(p.bytes)} — ${p.current}`;
    });
    if (writable) {
      await saveToWritable(stream, writable, active.signal);
      status.textContent = `${chosen.length}件を ${archiveName} に保存しました。`;
    } else {
      const blob = await saveToBlob(stream, config.blobLimitMiB, active.signal);
      active.signal.throwIfAborted();
      blobUrl = URL.createObjectURL(blob);
      saveLink.href = blobUrl;
      saveLink.download = archiveName;
      saveLink.hidden = false;
      status.textContent = `${chosen.length}件のZIP生成が完了しました。下のリンクから保存してください。`;
      saveLink.focus();
    }
  } catch (error) {
    await writable?.abort().catch(() => {
    });
    if (active.signal.aborted || error instanceof DOMException && error.name === "AbortError") status.textContent = "キャンセルしました。ZIPは保存完了していません。";
    else {
      status.textContent = "一括DLを中止しました。ZIPは保存完了していません。";
      errorBox.hidden = false;
      errorBox.textContent = error instanceof Error ? error.message : "ダウンロードに失敗しました";
    }
  } finally {
    active.abort();
    controller = void 0;
    el("progress-box").hidden = true;
    updateSelection();
  }
});
export function showCatalog(settings, catalog, preview = false) {
  const validated = validateCatalog(catalog);
  config = validateConfig(preview ? { ...settings, workerUrl: "" } : settings);
  previewMode = preview;
  document.title = config.title;
  el("title").textContent = config.title;
  el("description").textContent = config.description;
  files = validated.files;
  selected.clear();
  el("updated").textContent = preview ? "プレビュー：バージョン・サイズ・更新日は未取得" : `一覧更新: ${catalog.generatedAt ? new Date(catalog.generatedAt).toLocaleString("ja-JP") : "未更新"}`;
  el("warnings").textContent = catalog.warnings.join(" / ");
  el("warnings").hidden = !catalog.warnings.length;
  render();
}
async function init() {
  try {
    const settings = await fetch("./config.json", { cache: "no-cache", signal: AbortSignal.timeout(3e4) });
    if (!settings.ok) throw new Error("サイト設定を読み込めません");
    const response = await fetch("./catalog.json", { cache: "no-cache", signal: AbortSignal.timeout(3e4) });
    if (!response.ok) throw new Error(`一覧の取得に失敗しました (HTTP ${response.status})`);
    showCatalog(await settings.json(), await response.json());
  } catch (error) {
    el("count").textContent = "読み込み失敗";
    errorBox.hidden = false;
    errorBox.textContent = `${error instanceof Error ? error.message : "一覧の読み込み失敗"}。時間を置いて再読み込みしてください。`;
  }
}
if (!window.UPLOADER_PREVIEW) void init();
