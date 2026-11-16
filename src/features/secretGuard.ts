import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { calculateShannonEntropy, isHighEntropySecret } from '../utils/entropy';
import { debounce } from '../utils/debounce';
import { SecretFinding } from '../types';

export class SecretGuardFeature implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly syncDiagnosticCollection: vscode.DiagnosticCollection;
  private statusBarItem: vscode.StatusBarItem;
  private isDemoMode: boolean = false;
  private maskDecorationType: vscode.TextEditorDecorationType | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('devguard-secrets');
    this.syncDiagnosticCollection = vscode.languages.createDiagnosticCollection('devguard-env-sync');
    this.disposables.push(this.diagnosticCollection, this.syncDiagnosticCollection);

    // Initialize Status Bar Toggle
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'devguard.toggleDemoMode';
    this.updateStatusBar();
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);

    this.recreateDecorationType();

    // Register Commands
    this.disposables.push(
      vscode.commands.registerCommand('devguard.toggleDemoMode', () => this.toggleDemoMode()),
      vscode.commands.registerCommand('devguard.scanSecrets', () => this.scanActiveDocument()),
      vscode.commands.registerCommand('devguard.syncEnvExample', (envUri?: vscode.Uri) =>
        this.syncEnvToExample(envUri)
      ),
      vscode.commands.registerCommand('devguard.installGitHook', () => this.installPreCommitHook()),
      vscode.commands.registerCommand('devguard.compareEnvFiles', () => this.compareEnvFiles()),
      vscode.commands.registerCommand('devguard.autoGenerateEnvExample', () => this.autoGenerateEnvExample())
    );

    // Register CodeActionProvider for syncing .env keys
    this.disposables.push(
      vscode.languages.registerCodeActionsProvider(
        [{ scheme: 'file', pattern: '**/.env*' }],
        new EnvSyncCodeActionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
      )
    );

    // Wire Document & Editor Event Listeners
    const debouncedScan = debounce((doc: vscode.TextDocument) => this.scanDocument(doc), 400);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.applyDemoMaskingToEditor(editor);
          this.scanDocument(editor.document);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.applyDemoMaskingToEditor(editor);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document === event.document
        );
        if (editor) {
          this.applyDemoMaskingToEditor(editor);
        }
        debouncedScan(event.document);
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.scanDocument(doc);
        this.checkEnvSync(doc);
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri);
        this.syncDiagnosticCollection.delete(doc.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('devguard.demoMode.maskPattern')) {
          this.recreateDecorationType();
          this.applyDemoMaskingToAllVisibleEditors();
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      this.applyDemoMaskingToEditor(vscode.window.activeTextEditor);
      this.scanDocument(vscode.window.activeTextEditor.document);
      this.checkEnvSync(vscode.window.activeTextEditor.document);
    }
  }

  // --- DEMO MODE MASKING ---

  private recreateDecorationType(): void {
    if (this.maskDecorationType) {
      this.maskDecorationType.dispose();
    }

    const config = vscode.workspace.getConfiguration('devguard');
    const maskText = config.get<string>('demoMode.maskPattern', '••••••••••••••••');

    this.maskDecorationType = vscode.window.createTextEditorDecorationType({
      letterSpacing: '-1em',
      opacity: '0',
      after: {
        contentText: maskText,
        color: new vscode.ThemeColor('editorWarning.foreground'),
        fontStyle: 'italic',
      },
    });
  }

  public toggleDemoMode(): void {
    this.isDemoMode = !this.isDemoMode;
    this.updateStatusBar();

    vscode.window.showInformationMessage(
      `DevGuard Demo Mode is now ${this.isDemoMode ? 'ON (values masked)' : 'OFF'}`
    );

    this.applyDemoMaskingToAllVisibleEditors();
  }

  private updateStatusBar(): void {
    if (this.isDemoMode) {
      this.statusBarItem.text = '$(eye-closed) Demo Mode: ON';
      this.statusBarItem.tooltip = 'DevGuard Demo Mode: ON (.env values are visually masked). Click to toggle.';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.text = '$(eye) Demo Mode: OFF';
      this.statusBarItem.tooltip = 'DevGuard Demo Mode: OFF. Click to toggle secret masking.';
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  private isEnvFile(doc: vscode.TextDocument): boolean {
    const filename = path.basename(doc.fileName);
    return filename.startsWith('.env');
  }

  private applyDemoMaskingToAllVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyDemoMaskingToEditor(editor);
    }
  }

  private applyDemoMaskingToEditor(editor: vscode.TextEditor): void {
    if (!this.maskDecorationType) return;

    if (!this.isDemoMode || !this.isEnvFile(editor.document)) {
      editor.setDecorations(this.maskDecorationType, []);
      return;
    }

    const ranges: vscode.Range[] = [];
    const doc = editor.document;
    const lineCount = doc.lineCount;

    for (let i = 0; i < lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      if (text.trim().startsWith('#') || !text.includes('=')) continue;

      const eqIndex = text.indexOf('=');
      const valStart = eqIndex + 1;
      const rawVal = text.substring(valStart);

      if (rawVal.trim().length > 0) {
        ranges.push(new vscode.Range(new vscode.Position(i, valStart), line.range.end));
      }
    }

    editor.setDecorations(this.maskDecorationType, ranges);
  }

  // --- HARDCODED SECRET SCANNER ---

  public scanActiveDocument(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.scanDocument(editor.document);
      vscode.window.showInformationMessage(`DevGuard: Scanned ${path.basename(editor.document.fileName)} for secrets.`);
    }
  }

  private scanDocument(doc: vscode.TextDocument): void {
    const validExtensions = ['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.json', '.yaml', '.yml', '.env'];
    const ext = path.extname(doc.fileName).toLowerCase();
    const isCandidate = validExtensions.includes(ext) || path.basename(doc.fileName).startsWith('.env');

    if (!isCandidate || doc.isClosed) return;

    const config = vscode.workspace.getConfiguration('devguard');
    const entropyThreshold = config.get<number>('secretScanner.entropyThreshold', 4.2);
    const minSecretLen = config.get<number>('secretScanner.minSecretLength', 16);

    const findings: SecretFinding[] = [];
    const lineCount = doc.lineCount;

    const staticPatterns: Array<{ name: string; regex: RegExp; valueGroup?: number }> = [
      { name: 'AWS Access Key ID', regex: /\b(AKIA[0-9A-Z]{16})\b/g, valueGroup: 1 },
      { name: 'AWS Secret Access Key', regex: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, valueGroup: 1 },
      { name: 'GitHub Personal Access Token', regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g, valueGroup: 1 },
      { name: 'Stripe Secret Key', regex: /\b(sk_(?:live|test)_[0-9a-zA-Z]{24,})\b/g, valueGroup: 1 },
      { name: 'Slack Token', regex: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g, valueGroup: 1 },
      { name: 'JSON Web Token (JWT)', regex: /\b(eyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,})\b/g, valueGroup: 1 },
      { name: 'Private Key Header', regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g, valueGroup: 1 },
      { name: 'Generic API/Secret Assignment', regex: /(?:api_?key|auth_?token|secret_?key|client_?secret|private_?key|access_?token)\s*[:=]\s*(['"`])([^'"`\s]{16,})\1/gi, valueGroup: 2 },
    ];

    for (let i = 0; i < lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      if (/^\s*(\/\/|#|\/\*|\*)/.test(text) && !text.includes('PRIVATE KEY')) continue;

      for (const pattern of staticPatterns) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.regex.exec(text)) !== null) {
          const matchedVal = pattern.valueGroup ? match[pattern.valueGroup] : match[0];
          const valIndex = text.indexOf(matchedVal, match.index);

          if (pattern.name === 'Generic API/Secret Assignment') {
            if (!isHighEntropySecret(matchedVal, minSecretLen, entropyThreshold)) continue;
          }

          const entropy = calculateShannonEntropy(matchedVal);
          const range = new vscode.Range(
            new vscode.Position(i, valIndex),
            new vscode.Position(i, valIndex + matchedVal.length)
          );

          findings.push({ range, ruleName: pattern.name, matchedText: matchedVal, entropy });
        }
      }
    }

    const diagnostics: vscode.Diagnostic[] = findings.map((f) => {
      const entropyText = f.entropy ? ` (Entropy: ${f.entropy.toFixed(2)})` : '';
      const maskedSample = f.matchedText.length > 8
        ? `${f.matchedText.substring(0, 4)}...${f.matchedText.substring(f.matchedText.length - 4)}`
        : '••••';

      const diagnostic = new vscode.Diagnostic(
        f.range,
        `[DevGuard] Potential hardcoded secret detected: ${f.ruleName}${entropyText} [${maskedSample}]`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = 'DevGuard Secret Guard';
      diagnostic.code = 'hardcoded-secret';
      return diagnostic;
    });

    this.diagnosticCollection.set(doc.uri, diagnostics);
  }

  // --- .ENV VS .ENV.EXAMPLE SYNC & MULTI-ENV COMPARE ---

  private async checkEnvSync(doc: vscode.TextDocument): Promise<void> {
    const filename = path.basename(doc.fileName);
    if (!filename.startsWith('.env') || filename === '.env.example') return;

    const dir = path.dirname(doc.fileName);
    const examplePath = path.join(dir, '.env.example');

    if (!fs.existsSync(examplePath)) {
      this.syncDiagnosticCollection.delete(doc.uri);
      return;
    }

    const envKeys = this.extractEnvKeys(doc.getText());
    let exampleContent = '';
    try {
      exampleContent = fs.readFileSync(examplePath, 'utf8');
    } catch {
      return;
    }

    const exampleKeys = new Set(this.extractEnvKeys(exampleContent).map((k) => k.key));
    const missingKeys = envKeys.filter((k) => !exampleKeys.has(k.key));

    if (missingKeys.length === 0) {
      this.syncDiagnosticCollection.delete(doc.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = missingKeys.map((item) => {
      const line = doc.lineAt(item.line);
      const diagnostic = new vscode.Diagnostic(
        line.range,
        `[DevGuard] Key "${item.key}" is missing from .env.example`,
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.source = 'DevGuard .env Sync';
      diagnostic.code = 'missing-env-example-key';
      return diagnostic;
    });

    this.syncDiagnosticCollection.set(doc.uri, diagnostics);
  }

  private extractEnvKeys(content: string): Array<{ key: string; line: number }> {
    const keys: Array<{ key: string; line: number }> = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) {
        keys.push({ key: match[1], line: i });
      }
    }

    return keys;
  }

  public async syncEnvToExample(envUri?: vscode.Uri): Promise<void> {
    const targetUri = envUri || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showErrorMessage('DevGuard: No active .env file to sync.');
      return;
    }

    const dir = path.dirname(targetUri.fsPath);
    const examplePath = path.join(dir, '.env.example');

    if (!fs.existsSync(examplePath)) {
      await this.autoGenerateEnvExample(targetUri);
      return;
    }

    const envContent = fs.readFileSync(targetUri.fsPath, 'utf8');
    const exampleContent = fs.readFileSync(examplePath, 'utf8');
    const envKeys = this.extractEnvKeys(envContent);
    const exampleKeys = new Set(this.extractEnvKeys(exampleContent).map((k) => k.key));
    const keysToAdd = envKeys.filter((k) => !exampleKeys.has(k.key));

    if (keysToAdd.length === 0) {
      vscode.window.showInformationMessage('DevGuard: .env.example is already up to date!');
      this.syncDiagnosticCollection.delete(targetUri);
      return;
    }

    let appendedText = '\n# Synced from ' + path.basename(targetUri.fsPath) + '\n';
    for (const item of keysToAdd) {
      appendedText += `${item.key}=\n`;
    }

    const exampleUri = vscode.Uri.file(examplePath);
    const edit = new vscode.WorkspaceEdit();
    const exampleDoc = await vscode.workspace.openTextDocument(exampleUri);
    edit.insert(exampleUri, new vscode.Position(exampleDoc.lineCount, 0), appendedText);

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await exampleDoc.save();
      this.syncDiagnosticCollection.delete(targetUri);
      vscode.window.showInformationMessage(`DevGuard: Added ${keysToAdd.length} missing key(s) to .env.example.`);
    }
  }

  /**
   * Generates .env.example template from an existing .env file with values stripped.
   */
  public async autoGenerateEnvExample(targetUri?: vscode.Uri): Promise<void> {
    const uri = targetUri || vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      vscode.window.showErrorMessage('DevGuard: Please open a .env file first.');
      return;
    }

    const dir = path.dirname(uri.fsPath);
    const examplePath = path.join(dir, '.env.example');

    if (fs.existsSync(examplePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        '.env.example already exists. Overwrite it?',
        'Overwrite',
        'Cancel'
      );
      if (overwrite !== 'Overwrite') return;
    }

    const content = fs.readFileSync(uri.fsPath, 'utf8');
    const lines = content.split('\n');
    let template = '# Environment Configuration Template\n# Auto-generated by DevGuard Flow\n\n';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        template += '\n';
      } else if (trimmed.startsWith('#')) {
        template += `${trimmed}\n`;
      } else if (trimmed.includes('=')) {
        const key = trimmed.split('=')[0].trim();
        template += `${key}=\n`;
      }
    }

    fs.writeFileSync(examplePath, template, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(examplePath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('DevGuard: Generated clean .env.example template.');
  }

  /**
   * Multi-Environment Diff View: Compares two .env files side-by-side.
   */
  public async compareEnvFiles(): Promise<void> {
    const envFiles = await vscode.workspace.findFiles('**/.env*');
    if (envFiles.length < 2) {
      vscode.window.showInformationMessage('DevGuard: Need at least two .env files in the workspace to compare.');
      return;
    }

    const items = envFiles.map((f) => ({
      label: path.basename(f.fsPath),
      description: vscode.workspace.asRelativePath(f),
      uri: f,
    }));

    const file1 = await vscode.window.showQuickPick(items, { title: 'DevGuard: Select Base .env File' });
    if (!file1) return;

    const remainingItems = items.filter((i) => i.uri.fsPath !== file1.uri.fsPath);
    const file2 = await vscode.window.showQuickPick(remainingItems, { title: 'DevGuard: Select Target .env File to Compare Against' });
    if (!file2) return;

    const keys1 = new Set(this.extractEnvKeys(fs.readFileSync(file1.uri.fsPath, 'utf8')).map((k) => k.key));
    const keys2 = new Set(this.extractEnvKeys(fs.readFileSync(file2.uri.fsPath, 'utf8')).map((k) => k.key));

    const onlyIn1 = [...keys1].filter((k) => !keys2.has(k));
    const onlyIn2 = [...keys2].filter((k) => !keys1.has(k));

    let report = `### ⚖️ DevGuard Environment Diff Report\n\n`;
    report += `**File 1:** \`${file1.label}\` (${keys1.size} keys)\n`;
    report += `**File 2:** \`${file2.label}\` (${keys2.size} keys)\n\n`;

    if (onlyIn1.length === 0 && onlyIn2.length === 0) {
      report += `✅ **All environment keys match perfectly between both files!**\n`;
    } else {
      if (onlyIn1.length > 0) {
        report += `#### 🔴 Present in ${file1.label} but missing in ${file2.label} (${onlyIn1.length}):\n`;
        report += onlyIn1.map((k) => `- \`${k}\``).join('\n') + '\n\n';
      }
      if (onlyIn2.length > 0) {
        report += `#### 🔵 Present in ${file2.label} but missing in ${file1.label} (${onlyIn2.length}):\n`;
        report += onlyIn2.map((k) => `- \`${k}\``).join('\n') + '\n\n';
      }
    }

    const doc = await vscode.workspace.openTextDocument({
      content: report,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /**
   * Installs pre-commit hook in .git/hooks to block committing secrets.
   */
  public async installPreCommitHook(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage('DevGuard: No open workspace folder found.');
      return;
    }

    const root = folders[0].uri.fsPath;
    const gitDir = path.join(root, '.git');
    const hooksDir = path.join(gitDir, 'hooks');

    if (!fs.existsSync(gitDir)) {
      vscode.window.showErrorMessage('DevGuard: Not a git repository (no .git folder).');
      return;
    }

    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const hookScript = `#!/bin/sh
# DevGuard Flow Pre-Commit Security Hook
echo "[DevGuard] Inspecting staged files for secrets..."

# 1. Check if .env is staged
if git diff --cached --name-only | grep -E '^(\\.env|.*/\\.env)'; then
  echo "❌ [DevGuard Alert] Attempting to commit an unencrypted .env file!"
  echo "Please unstage .env before committing."
  exit 1
fi

# 2. Check for high-risk hardcoded secret patterns
SECRET_REGEX="AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{24,}|ghp_[0-9a-zA-Z]{36,}"
if git diff --cached -U0 | grep -E "$SECRET_REGEX" > /dev/null 2>&1; then
  echo "❌ [DevGuard Alert] Hardcoded secret tokens detected in staged diff!"
  echo "Commit aborted to protect sensitive credentials."
  exit 1
fi

echo "✓ [DevGuard] Staged files passed secret guard check."
exit 0
`;

    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, hookScript, { encoding: 'utf8', mode: 0o755 });

    vscode.window.showInformationMessage('DevGuard: Pre-commit secret guard hook installed successfully in .git/hooks/pre-commit!');
  }

  public dispose(): void {
    if (this.maskDecorationType) this.maskDecorationType.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

class EnvSyncCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const syncDiagnostics = context.diagnostics.filter(
      (d) => d.source === 'DevGuard .env Sync'
    );
    if (syncDiagnostics.length === 0) return [];

    const action = new vscode.CodeAction(
      'DevGuard: Sync missing keys to .env.example (without values)',
      vscode.CodeActionKind.QuickFix
    );
    action.command = {
      command: 'devguard.syncEnvExample',
      title: 'Sync missing keys to .env.example',
      arguments: [document.uri],
    };
    action.diagnostics = syncDiagnostics;
    action.isPreferred = true;
    return [action];
  }
}
