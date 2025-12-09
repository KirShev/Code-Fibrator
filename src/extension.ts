import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('avsReplace.start', async () => {
    const panel = vscode.window.createWebviewPanel(
      'avsReplacePanel',
      'AVS Replace',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = getHtml();

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'run') {
        try {
          const uri = vscode.Uri.parse(msg.fileUri);
          const content = (await vscode.workspace.fs.readFile(uri)).toString();
          const replaced = applyReplacements(content, msg.pairs as Array<{ find: string; replace: string }>);

          const filename = uri.path.split('/').pop() || 'file';
          const newName = `AVS-${filename}`;
          const dirPath = uri.path.slice(0, uri.path.lastIndexOf('/'));
          const dirUri = uri.with({ path: dirPath });
          const newUri = vscode.Uri.joinPath(dirUri, newName);

          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(newUri, encoder.encode(replaced));
          vscode.window.showInformationMessage(`Created: ${newUri.fsPath}`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error: ${err?.message || String(err)}`);
        }
      } else if (msg.command === 'pickFile') {
        const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
        panel.webview.postMessage({ reply: msg.id, uris: uris?.map((u: vscode.Uri) => u.toString()) });
      }
    });
  });

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

function getHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; padding: 12px; }
      .row { margin-bottom: 10px; }
      input[type=text] { width: 100%; padding: 6px; }
      button { padding: 6px 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px; }
    </style>
  </head>
  <body>
    <div class="row">
      <button id="pick">Choisir le fichier…</button>
      <span id="fileName"></span>
    </div>
    <div class="row">
      <table id="pairs">
        <thead>
          <tr><th>Mot à trouver</th><th>Remplacer par</th><th></th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <button id="add">Ajouter une paire</button>
    </div>
    <div class="row">
      <button id="run">Générer le fichier AVS</button>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      let fileUri = null;

      document.getElementById('add').addEventListener('click', addRow);
      document.getElementById('pick').addEventListener('click', async () => {
        const res = await window.vscodePickFile();
        if (res && res[0]) {
          fileUri = res[0];
          document.getElementById('fileName').textContent = new URL(fileUri).pathname.split('/').pop();
        }
      });
      document.getElementById('run').addEventListener('click', () => {
        const pairs = collectPairs();
        if (!fileUri) { alert('Veuillez choisir un fichier'); return; }
        vscode.postMessage({ command: 'run', fileUri, pairs });
      });

      addRow();

      function addRow() {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><input type="text" placeholder="mot"/></td>' +
                       '<td><input type="text" placeholder="remplacement"/></td>' +
                       '<td><button>Supprimer</button></td>';
        tr.querySelector('button').addEventListener('click', () => tr.remove());
        document.querySelector('#pairs tbody').appendChild(tr);
      }
      function collectPairs() {
        const rows = Array.from(document.querySelectorAll('#pairs tbody tr'));
        return rows.map(r => {
          const inputs = r.querySelectorAll('input');
          return { find: inputs[0].value, replace: inputs[1].value };
        });
      }

      // Simple helper using VS Code open dialog via message loop
      window.vscodePickFile = () => new Promise(resolve => {
        const id = Math.random().toString(36).slice(2);
        window.addEventListener('message', function handler(ev) {
          const m = ev.data; if (m && m.reply === id) { window.removeEventListener('message', handler); resolve(m.uris); }
        });
        vscode.postMessage({ command: 'pickFile', id });
      });
    </script>
  </body>
</html>`;
}
