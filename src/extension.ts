import * as vscode from 'vscode';

const STATEKEY = 'avsReplace.savedPairs';
const STATEFILE = 'avsReplace.lastFile';
const STATESTRIP = 'avsReplace.stripComments';

export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;

  const showPanel = () => {
    if (panel) {
      panel.reveal();
      return;
    }

    const savedPairs = context.globalState.get(STATEKEY, []) as Array<{ find: string; replace: string }>;
    const lastFile = context.globalState.get(STATEFILE, '') as string;
    const stripComments = !!context.globalState.get(STATESTRIP, false);

    panel = vscode.window.createWebviewPanel(
      'avsReplacePanel',
      'AVS Replace',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getHtml(savedPairs, lastFile, stripComments);

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === 'run') {
          const uri = vscode.Uri.parse(msg.fileUri);
          const raw = (await vscode.workspace.fs.readFile(uri)).toString();
          const input = msg.stripComments ? stripAllComments(raw) : raw;

          const replaced = applyReplacements(input, msg.pairs as Array<{ find: string; replace: string }>);
          const filename = uri.path.split('/').pop() || 'file';
          const newName = `AVS-${filename}`;
          const dirPath = uri.path.slice(0, uri.path.lastIndexOf('/'));
          const dirUri = uri.with({ path: dirPath });
          const newUri = vscode.Uri.joinPath(dirUri, newName);

          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(newUri, encoder.encode(replaced));
          vscode.window.showInformationMessage(`Fichier généré: ${newUri.fsPath}`);
        } else if (msg.command === 'pickFile') {
          const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false });
          const pick = uris?.[0]?.toString() || '';
          if (pick) context.globalState.update(STATEFILE, pick);
          panel?.webview.postMessage({ reply: msg.id, uris: pick ? [pick] : [] });
        } else if (msg.command === 'savePairs') {
          context.globalState.update(STATEKEY, msg.pairs);
          panel?.webview.postMessage({ saved: true });
        } else if (msg.command === 'setStrip') {
          context.globalState.update(STATESTRIP, !!msg.value);
          panel?.webview.postMessage({ stripSaved: true });
        } else if (msg.command === 'confirmDelete') {
          const idx = typeof msg.index === 'number' ? msg.index : undefined;
          const preview = [msg.find, msg.replace].filter(Boolean).join(' → ');
          const detail = preview ? `\n${preview}` : '';
          const choice = await vscode.window.showWarningMessage(`Supprimer cette paire ?${detail}`, { modal: true }, 'Supprimer');
          if (msg.id) {
            panel?.webview.postMessage({ reply: msg.id, confirmed: choice === 'Supprimer', index: idx });
          }
        } else if (msg.command === 'debugLog') {
          const details = Array.isArray(msg.payload) ? msg.payload.join(' ') : String(msg.payload ?? '');
          console.log(`[AVS Replace][webview] ${details}`);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Erreur: ${err?.message || String(err)}`);
      }
    });

    panel.onDidDispose(() => { panel = undefined; });
  };

  const disposable = vscode.commands.registerCommand('avsReplace.start', showPanel);
  context.subscriptions.push(disposable);
}

export function deactivate() {}

function applyReplacements(text: string, pairs: Array<{ find: string; replace: string }>): string {
  let output = text;
  for (const { find, replace } of pairs) {
    if (!find) { continue; }
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    output = output.replace(re, replace ?? '');
  }
  return output;
}

function stripAllComments(text: string): string {
  let out = text.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\r\n]*/g, '');
  return out.replace(/[ \t]+\r?\n/g, '\n');
}

function getHtml(savedPairs: Array<{ find: string; replace: string }>, lastFile: string, stripComments: boolean): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AVS Replace</title>
  <style>
    :root {
      --background: #f6f8fa;
      --primary: #2563eb;
      --primary-light: #a5b4fc;
      --danger: #b91c1c;
      --card: #fff;
      --header: #1a202c;
      --muted: #606060;
      --shadow: 0 2px 8px 0 #1112;
    }
    html, body { height:100%; margin:0; background:var(--background);}
    body { font:16px system-ui,sans-serif; padding:0; margin:0; color:var(--header);}
    .wrapper {
      max-width:560px; margin:32px auto 0; background:var(--card); box-shadow:var(--shadow);
      padding:28px 28px 68px 28px; border-radius:10px; min-height:520px; position:relative;
    }
    h2 { margin-top:0; font-weight:700;}
    .filebox {
      border:2px dashed var(--primary-light); border-radius:8px; padding:16px;
      display:flex; align-items:center; cursor:pointer; background:var(--background);
      transition:box-shadow .14s;
    }
    .filebox.selected { border:2px solid var(--primary);}
    .filebox span { font-size:1.05em; margin-left:8px; color:var(--header); }
    .filebox small { color:var(--muted); margin-left:10px; }
    .options { display:flex; align-items:center; gap:14px; margin:16px 0 6px 0; color:#333; }
    .toggle { display:flex; align-items:center; gap:8px; user-select:none; cursor:pointer; }
    .toggle input { width:18px; height:18px; }
    .pairs-table { width:100%; border-collapse:separate; border-spacing:0 4px; margin:20px 0 12px 0; }
    .pairs-table th { text-align:left; font-weight:500; color:var(--muted); font-size:14px; padding-bottom:4px;}
    .pairs-table td { background:#f5f7fa; border-radius:5px; padding:3px 3px 3px 2px; vertical-align:middle;}
    .action-btn {
      background:#fff;
      border:1px solid #ccd;
      border-radius:4px;
      cursor:pointer;
      padding:4px 8px;
      font-size:13px;
    }
    .action-btn:hover { background:#eef; }
    .drag-btn { cursor:grab; font-weight:600; }
    .pairs-table tbody tr.dragging { opacity:.4; }
    .pairs-table tbody tr.drag-target { box-shadow:0 4px 18px #1e2e8233; }
    .pairs-table tbody tr.empty td {
      background:none;
      color:var(--muted);
      font-style:italic;
      padding:26px 0;
      text-align:center;
    }
    .float-btn {
      position:fixed; right:40px; bottom:44px; width:48px; height:48px; background:var(--primary);
      color:#fff; border-radius:50%; border:none; box-shadow:0 4px 24px #1112;
      font-size:2em; display:flex; align-items:center; justify-content:center; z-index:22;
      transition:background .14s;
    }
    .float-btn:hover { background:#3354b4; }
    .btn-row { margin-top:18px; display:flex; justify-content:flex-end; }
    .primary-btn {
      background: var(--primary); color: #fff; border: none; border-radius: 6px;
      font-size: 1em; font-weight: 600; padding: 8px 22px; cursor:pointer; box-shadow:0 2px 8px #2342;
      transition:background .17s;
    }
    .primary-btn[disabled] { opacity:.5; cursor:not-allowed;}
    .toast {
      position:fixed; top:32px; right:40px; background:var(--primary);
      color:#fff; padding:13px 27px; font-weight:600; border-radius:8px; box-shadow:var(--shadow);
      opacity:0; pointer-events:none; transition:opacity .14s;
      z-index:500;
    }
    .toast.show { opacity:1; pointer-events:auto;}
    .debug-panel { margin-top:24px; font-size:13px; color:var(--muted); }
    .debug-panel[open] { color:var(--header); }
    .debug-log {
      background:#f0f3f9;
      border:1px solid #d5dae3;
      border-radius:6px;
      padding:10px;
      max-height:200px;
      overflow:auto;
      font-family:Consolas,monospace;
      font-size:12px;
      color:#1f2937;
    }
    .debug-log div { margin-bottom:4px; }
    .debug-log div:last-child { margin-bottom:0; }
    @media(max-width:600px){
      .wrapper { max-width:99vw; margin:5vw 0 0 0; padding:10px 1vw 60px 1vw; }
      .float-btn { right:10vw; }
    }
    input[type="text"] { border:1px solid #aac; border-radius:4px; font-size:1em; padding:6px 10px; width:96%;box-sizing:border-box; }
    input[type="text"]:focus { border:1.6px solid var(--primary);}
    tr.dragging { opacity:.4; }
  </style>
</head>
<body>
  <div class="wrapper">
    <h2>AVS Replace</h2>
    <div class="filebox${lastFile ? ' selected' : ''}" id="filePick">
      <span>${lastFile ? "📄 "+escapeHtml(getFilename(lastFile)) : "Cliquez pour choisir un fichier à modifier…"}</span>
      ${lastFile ? `<small>Changer</small>` : ''}
    </div>

    <div class="options">
      <label class="toggle" title="Supprimer les commentaires (//, /* */, <!-- -->)">
        <input type="checkbox" id="stripToggle" ${stripComments ? 'checked' : ''}/>
        <span>Supprimer les commentaires</span>
      </label>
    </div>

    <table class="pairs-table" id="pairs">
      <thead>
        <tr>
          <th style="width:38%">Mot à trouver</th>
          <th style="width:45%">Remplacer par</th>
          <th style="width:8%"></th>
          <th style="width:9%"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>

    <button class="float-btn" id="addPair" title="Ajouter une paire" type="button">+</button>
    <div class="btn-row">
      <button class="primary-btn" id="runBtn" type="button">Générer le fichier AVS</button>
    </div>
    <details class="debug-panel" id="debugPanel">
      <summary>Journal de débogage</summary>
      <div id="debugLog" class="debug-log"></div>
    </details>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let fileUri = ${lastFile ? `'${lastFile}'` : 'null'};
    let pairs = ${JSON.stringify(savedPairs)};
    let stripComments = ${stripComments ? 'true' : 'false'};
    let dragFrom = -1;
    const pendingReplies = new Map();

    const $ = sel => document.querySelector(sel), $$ = sel => Array.from(document.querySelectorAll(sel));
    const closestElement = (target, selector) => {
      if (!target) return null;
      if (target instanceof Element) return target.closest(selector);
      if (target instanceof Node && target.parentElement) {
        return target.parentElement.closest(selector);
      }
      return null;
    };
    const appendDebugMessage = (msg) => {
      const container = $('#debugLog');
      if (!container) return;
      const entry = document.createElement('div');
      const stamp = new Date().toLocaleTimeString();
      entry.textContent = '[' + stamp + '] ' + msg;
      container.appendChild(entry);
      while (container.children.length > 200) {
        container.removeChild(container.firstChild);
      }
      container.scrollTop = container.scrollHeight;
    };
    const debugLog = (...args) => {
      console.log('[AVS Replace]', ...args);
      appendDebugMessage(args.map(String).join(' '));
      vscode.postMessage({ command: 'debugLog', payload: args.map(String) });
    };
    const requestHost = (command, payload = {}) => {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve) => {
        pendingReplies.set(id, resolve);
        vscode.postMessage({ command, id, ...payload });
        setTimeout(() => {
          if (pendingReplies.has(id)) {
            pendingReplies.delete(id);
            resolve({ timeout: true });
            debugLog('Host request timed out for command', command, 'id', id);
          }
        }, 15000);
      });
    };
    const rowIndex = (row) => {
      if (!row) return -1;
      const idx = Number(row.dataset.index ?? '-1');
      return Number.isFinite(idx) ? idx : -1;
    };
    const showToast = msg => { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800);};
    const updateFileBox = () => {
      const fb = $('#filePick');
      fb.classList.toggle('selected', !!fileUri);
      fb.querySelector('span').textContent = fileUri ? "📄 " + getFilename(fileUri) : "Cliquez pour choisir un fichier à modifier…";
      if (fileUri) {
        if (!fb.querySelector('small')) {
          let s = document.createElement('small');
          s.textContent = 'Changer';
          fb.appendChild(s);
        }
      } else {
        if (fb.querySelector('small')) {
          fb.querySelector('small').remove();
        }
      }
    };

    function renderPairs() {
      const tb = $('#pairs tbody');
      tb.innerHTML = '';
      if (!pairs.length) {
        const placeholder = document.createElement('tr');
        placeholder.className = 'empty';
        placeholder.innerHTML = '<td colspan="4">Aucune paire. Cliquez sur + pour en ajouter.</td>';
        tb.appendChild(placeholder);
        debugLog('Rendered pairs placeholder (0 pair)');
        return;
      }

      const frag = document.createDocumentFragment();
      pairs.forEach((p, i) => {
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.dataset.index = String(i);
        tr.innerHTML =
          '<td><input data-field="find" type="text" placeholder="ex: Jean" value="' + escapeHtml(p.find) + '"/></td>' +
          '<td><input data-field="replace" type="text" placeholder="ex: John" value="' + escapeHtml(p.replace) + '"/></td>' +
          '<td><button class="action-btn del-btn" type="button" title="Supprimer">Suppr.</button></td>' +
          '<td><button class="action-btn drag-btn" type="button" title="Déplacer (glisser)">::</button></td>';
        frag.appendChild(tr);
      });
      tb.appendChild(frag);
      debugLog('Rendered pairs rows', pairs.length);
    }

    function savePairs() {
      vscode.postMessage({ command:'savePairs', pairs });
    }

    function saveStrip() {
      vscode.postMessage({ command:'setStrip', value: stripComments });
    }

    window.addEventListener('message', evt => {
      const msg = evt.data;
      if (!msg) return;
      if (msg.reply && pendingReplies.has(msg.reply)) {
        const resolver = pendingReplies.get(msg.reply);
        pendingReplies.delete(msg.reply);
        resolver(msg);
      }
      if (msg.saved) showToast('Modifications enregistrées!');
      if (msg.stripSaved) showToast('Option enregistrée');
    });

    function addPair() {
      pairs.push({ find:'', replace:'' });
      renderPairs();
      savePairs();
      showToast('Paire ajoutée');
    }
    function getFilename(u) {
      try { return (new URL(u)).pathname.split('/').pop(); } catch { return u;}
    }
    function escapeHtml(t) {
      return String(t ?? '')
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
    }

    const tbody = $('#pairs tbody');
    const addBtn = $('#addPair');
    const runBtn = $('#runBtn');
    const fileBox = $('#filePick');
    const stripToggleEl = $('#stripToggle');

    if (!(tbody instanceof HTMLElement) || !(addBtn instanceof HTMLButtonElement) || !(runBtn instanceof HTMLButtonElement) || !(fileBox instanceof HTMLElement) || !(stripToggleEl instanceof HTMLInputElement)) {
      console.error('AVS Replace: éléments UI manquants');
    } else {
      const stripToggle = stripToggleEl;

      addBtn.addEventListener('click', () => {
        debugLog('Add button clicked');
        addPair();
      });

      fileBox.addEventListener('click', async () => {
        debugLog('File picker requested');
        const res = await window.vscodePickFile();
        if (res && res[0]) {
          fileUri = res[0];
          updateFileBox();
          savePairs();
          debugLog('File selected', fileUri);
        }
      });

      stripToggle.addEventListener('change', () => {
        stripComments = !!stripToggle.checked;
        saveStrip();
        showToast('Option mise à jour');
        debugLog('Strip toggle set to', stripComments);
      });

      runBtn.addEventListener('click', () => {
        if (!fileUri) {
          showToast('Veuillez choisir un fichier!');
          debugLog('Run aborted: no file selected');
          return;
        }
        vscode.postMessage({ command:'run', fileUri, pairs, stripComments });
        debugLog('Run requested on', fileUri, 'with', pairs.length, 'pairs');
      });

      tbody.addEventListener('click', async (event) => {
        const target = event.target;
        const btn = closestElement(target, 'button');
        if (!btn || !btn.classList.contains('action-btn')) return;
        const row = closestElement(btn, 'tr');
        const idx = rowIndex(row);
        if (idx < 0) {
          debugLog('Click ignoring button without index');
          return;
        }
        if (btn.classList.contains('del-btn')) {
          event.preventDefault();
          debugLog('Confirm delete requested for index', idx);
          const response = await requestHost('confirmDelete', { index: idx, find: pairs[idx]?.find ?? '', replace: pairs[idx]?.replace ?? '' });
          if (!response || response.timeout) {
            debugLog('Deletion cancelled (timeout) for index', idx);
            return;
          }
          if (!response.confirmed) {
            debugLog('Deletion cancelled by user for index', idx);
            return;
          }
          debugLog('Deleting pair at index', idx);
          pairs.splice(idx, 1);
          renderPairs();
          savePairs();
          showToast('Paire supprimée');
        }
      });

      tbody.addEventListener('input', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || !input.dataset.field) return;
        const row = closestElement(input, 'tr');
        const idx = rowIndex(row);
        if (idx < 0 || !pairs[idx]) {
          debugLog('Input change ignored, invalid index', idx);
          return;
        }
        const field = input.dataset.field === 'replace' ? 'replace' : 'find';
        pairs[idx][field] = input.value;
        debugLog('Updated field', field, 'at index', idx, 'to', input.value);
        savePairs();
      });

      tbody.addEventListener('dragstart', (event) => {
        const row = closestElement(event.target, 'tr');
        if (!row || row.classList.contains('empty')) {
          event.preventDefault();
          return;
        }
        dragFrom = rowIndex(row);
        if (dragFrom < 0) {
          event.preventDefault();
          return;
        }
        row.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }
        debugLog('Drag start from index', dragFrom);
      });

      tbody.addEventListener('dragover', (event) => {
        const row = closestElement(event.target, 'tr');
        if (!row || row.classList.contains('empty')) return;
        event.preventDefault();
        if (!row.classList.contains('dragging')) {
          row.classList.add('drag-target');
        }
      });

      tbody.addEventListener('dragleave', (event) => {
        const row = closestElement(event.target, 'tr');
        if (row) {
          row.classList.remove('drag-target');
        }
      });

      tbody.addEventListener('drop', (event) => {
        const row = closestElement(event.target, 'tr');
        if (!row || row.classList.contains('empty')) return;
        event.preventDefault();
        row.classList.remove('drag-target');
        const to = rowIndex(row);
        if (dragFrom < 0 || to < 0 || dragFrom === to) {
          debugLog('Drop ignored', 'from', dragFrom, 'to', to);
          return;
        }
        const [moved] = pairs.splice(dragFrom, 1);
        pairs.splice(to, 0, moved);
        renderPairs();
        savePairs();
        showToast('Réordonné');
        debugLog('Moved pair from', dragFrom, 'to', to);
      });

      tbody.addEventListener('dragend', () => {
        dragFrom = -1;
        $$('#pairs tbody tr').forEach(function(t){ t.classList.remove('dragging', 'drag-target'); });
        debugLog('Drag end');
      });
    }

    window.vscodePickFile = async () => {
      const response = await requestHost('pickFile');
      if (response?.timeout) {
        debugLog('File picker request timed out');
        return [];
      }
      return response?.uris ?? [];
    };

    updateFileBox(); renderPairs();
    debugLog('Webview ready', 'pairs:', pairs.length, 'file:', fileUri || 'none');
  </script>
</body>
</html>`;
}

function getFilename(url: string): string {
  try {
    return (new URL(url)).pathname.split('/').pop() ?? 'file';
  } catch { return 'file'; }
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}