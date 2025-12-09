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
  const iconAdd = `<svg width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="#888" stroke-width="1.5" fill="#fff"/><line x1="8" y1="4" x2="8" y2="12" stroke="#555" stroke-width="2"/><line x1="4" y1="8" x2="12" y2="8" stroke="#555" stroke-width="2"/></svg>`;
  const iconDel = `<svg width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="#999" stroke-width="1.5" fill="#fff"/><line x1="5" y1="8" x2="11" y2="8" stroke="#d00" stroke-width="2"/></svg>`;
  const iconMove = `<svg width="12" height="16" fill="currentColor" style="cursor: grab;" aria-hidden="true"><rect x="4" y="3" width="4" height="2" rx="1" fill="#bbb"/><rect x="4" y="7" width="4" height="2" rx="1" fill="#bbb"/><rect x="4" y="11" width="4" height="2" rx="1" fill="#bbb"/></svg>`;

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
    .action-btn { background:none; border:none; cursor:pointer; padding:3px 6px; display:inline-flex; align-items:center; }
    .drag-btn { cursor:grab; padding-right:3px;}
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

    <button class="float-btn" id="addPair" title="Ajouter une paire" type="button">${iconAdd}</button>
    <div class="btn-row">
      <button class="primary-btn" id="runBtn" type="button">Générer le fichier AVS</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let fileUri = ${lastFile ? `'${lastFile}'` : 'null'};
    let pairs = ${JSON.stringify(savedPairs)};
    let stripComments = ${stripComments ? 'true' : 'false'};

    const $ = sel => document.querySelector(sel), $$ = sel => Array.from(document.querySelectorAll(sel));
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
      const tb = $('#pairs tbody'); tb.innerHTML = '';
      pairs.forEach((p) => {
        const tr = document.createElement('tr'); tr.setAttribute('draggable','true');
        tr.innerHTML =
        '<td><input type="text" placeholder="ex: Jean" value="'+escapeHtml(p.find)+'"/></td>'+
        '<td><input type="text" placeholder="ex: John" value="'+escapeHtml(p.replace)+'"/></td>'+
        '<td><button class="action-btn del-btn" type="button" title="Supprimer">${iconDel}</button></td>'+
        '<td><button class="action-btn drag-btn" type="button" title="Déplacer (glisser)">${iconMove}</button></td>';
        tb.appendChild(tr);

        // Persist edits on blur
        const inputs = tr.querySelectorAll('input');
        inputs[0].addEventListener('blur', () => { const idx = indexOfRow(tr); if (idx >= 0) { pairs[idx].find = inputs[0].value; savePairs(); }});
        inputs[1].addEventListener('blur', () => { const idx = indexOfRow(tr); if (idx >= 0) { pairs[idx].replace = inputs[1].value; savePairs(); }});

        // Drag handlers
        tr.ondragstart = e => { e.dataTransfer.effectAllowed = "move"; tr.classList.add('dragging'); e.dataTransfer.setData('fromIndex', indexOfRow(tr)); };
        tr.ondragend = () => $$('#pairs tbody tr').forEach(t=>t.classList.remove('dragging'));
        tr.ondragover = e => {e.preventDefault(); tr.style.boxShadow='0 4px 24px #1e2e8233';}
        tr.ondragleave = () => tr.style.boxShadow='';
        tr.ondrop = e => {
          e.preventDefault(); tr.style.boxShadow='';
          const from = +e.dataTransfer.getData('fromIndex');
          const to = indexOfRow(tr);
          if (Number.isFinite(from) && Number.isFinite(to) && from!==to) {
            let [m] = pairs.splice(from,1);
            pairs.splice(to,0,m);
            renderPairs(); savePairs(); showToast('Réordonné');
          }
        };
      });
      if(!pairs.length) addPair();
    }

    // Robust event delegation for delete (works when clicking SVG/icon)
    $('#pairs tbody').addEventListener('click', (ev) => {
      const target = ev.target;
      const btn = target && target.closest ? target.closest('.del-btn') : null;
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const idx = indexOfRow(tr);
      if (idx < 0) return;
      if (confirm('Supprimer cette paire ?')) {
        pairs.splice(idx, 1);
        renderPairs();
        savePairs();
        showToast('Paire supprimée');
      }
    });

    function indexOfRow(tr) {
      const rows = $$('#pairs tbody tr');
      return rows.indexOf(tr);
    }

    function savePairs() {
      vscode.postMessage({ command:'savePairs', pairs });
    }

    function saveStrip() {
      vscode.postMessage({ command:'setStrip', value: stripComments });
    }

    window.addEventListener('message', evt => {
      const msg = evt.data;
      if (msg.saved) showToast('Modifications enregistrées!');
      if (msg.stripSaved) showToast('Option enregistrée');
    });

    function addPair() {
      pairs.push({ find:'', replace:'' }); renderPairs(); savePairs();
    }
    function getFilename(u) {
      try { return (new URL(u)).pathname.split('/').pop(); } catch { return u;}
    }
    function escapeHtml(t) {
      return String(t ?? '')
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
    }

    $('#addPair').onclick = addPair;
    $('#filePick').onclick = async () => {
      const res = await window.vscodePickFile();
      if (res && res[0]) { fileUri = res[0]; updateFileBox(); savePairs(); }
    };
    $('#stripToggle').onchange = (e) => { stripComments = !!e.target.checked; saveStrip(); };

    $('#runBtn').onclick = () => {
      if (!fileUri) return showToast('Veuillez choisir un fichier!');
      vscode.postMessage({ command:'run', fileUri, pairs, stripComments });
    };

    window.vscodePickFile = () => new Promise(resolve => {
      const id = Math.random().toString(36).slice(2);
      window.addEventListener('message', function handler(ev) {
        const m = ev.data; if (m && m.reply === id) { window.removeEventListener('message', handler); resolve(m.uris); }
      });
      vscode.postMessage({ command: 'pickFile', id });
    });

    updateFileBox(); renderPairs();
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