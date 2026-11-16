import * as vscode from 'vscode';
import * as path from 'path';
import { getBranchAddedLines } from '../utils/git';
import { debounce } from '../utils/debounce';
import { matchDebugStatement, getCommentPrefix } from '../utils/debugPatterns';
import { DebugLogEntry } from '../types';

export type ScanScope = 'entireRepo' | 'branchOnly';

export class LogCleanerFeature implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private logDecorationType: vscode.TextEditorDecorationType;
  private statusBarItem: vscode.StatusBarItem;
  private treeDataProvider: DebugFinderTreeDataProvider;
  private branchAddedLinesCache = new Map<string, Set<number>>();
  private allRepoLogsCache = new Map<string, DebugLogEntry[]>();
  private currentScope: ScanScope = 'entireRepo';
  private fileFilter: string = '';

  constructor(private readonly context: vscode.ExtensionContext) {
    // Subtle visual indicator for debug statements
    this.logDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 153, 0, 0.12)',
      border: '1px solid rgba(255, 153, 0, 0.35)',
      borderRadius: '2px',
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.disposables.push(this.logDecorationType);

    // TreeDataProvider for Sidebar Debug Finder
    this.treeDataProvider = new DebugFinderTreeDataProvider(
      () => this.getVisibleLogEntries(),
      () => this.currentScope,
      () => this.fileFilter
    );
    this.disposables.push(
      vscode.window.registerTreeDataProvider('devguard.debugFinderView', this.treeDataProvider)
    );

    // Status Bar Counter
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.statusBarItem.command = 'devguard.scanRepoLogs';
    this.disposables.push(this.statusBarItem);

    // Register Commands
    this.disposables.push(
      vscode.commands.registerCommand('devguard.cleanBranchLogs', () => this.cleanBranchLogs()),
      vscode.commands.registerCommand('devguard.scanRepoLogs', () => this.scanEntireRepo(true)),
      vscode.commands.registerCommand('devguard.cleanWorkspaceLogs', () => this.cleanWorkspaceLogs()),
      vscode.commands.registerCommand('devguard.filterRepoLogs', () => this.promptFilterByFilename()),
      vscode.commands.registerCommand('devguard.toggleLogScope', () => this.toggleScanScope()),
      vscode.commands.registerCommand('devguard.refreshRepoLogs', () => this.refreshDecorations()),
      vscode.commands.registerCommand('devguard.transformLogs', () => this.transformLogs()),
      vscode.commands.registerCommand('devguard.openLogLocation', (entry: DebugLogEntry) =>
        this.openLocation(entry)
      ),
      vscode.commands.registerCommand('devguard.deleteLogItem', (node: any) =>
        this.deleteLogNode(node)
      ),
      vscode.commands.registerCommand('devguard.commentLogItem', (node: any) =>
        this.commentLogNode(node)
      )
    );

    // Wire refresh events
    const debouncedRefresh = debounce(() => this.refreshDecorations(), 500);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document === e.document) {
          this.decorateEditor(activeEditor);
        }
        debouncedRefresh();
      }),
      vscode.workspace.onDidSaveTextDocument(() => debouncedRefresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('devguard.baseBranch') ||
          e.affectsConfiguration('devguard.customLogPatterns')
        ) {
          this.refreshDecorations();
        }
      })
    );

    // Initial scan
    this.refreshDecorations();
  }

  /**
   * Refreshes the diff cache, repository scan, and visible editor decorations.
   */
  public async refreshDecorations(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.updateStatusBar(0);
      return;
    }

    const config = vscode.workspace.getConfiguration('devguard');
    const baseBranch = config.get<string>('baseBranch', 'main');

    // 1. Refresh git diff cache
    for (const folder of folders) {
      const addedLinesMap = await getBranchAddedLines(folder.uri.fsPath, baseBranch);
      for (const [filePath, lineSet] of addedLinesMap.entries()) {
        this.branchAddedLinesCache.set(path.normalize(filePath), lineSet);
      }
    }

    // 2. Perform repo-wide scan
    await this.scanEntireRepo(false);

    // 3. Decorate visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorateEditor(editor);
    }

    // 4. Update Sidebar Tree View & Status Bar
    const visibleLogs = this.getVisibleLogEntries();
    let totalLogs = 0;
    for (const list of visibleLogs.values()) {
      totalLogs += list.length;
    }

    this.updateStatusBar(totalLogs);
    this.treeDataProvider.refresh();
  }

  /**
   * Scans entire workspace for debug statements across all supported languages.
   */
  public async scanEntireRepo(showNotification: boolean = false): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    const includePattern =
      '**/*.{ts,js,tsx,jsx,py,java,kt,c,cpp,cs,go,rs,php,rb,swift,dart,sh,ps1,ex,exs,r,lua,scala,pl}';
    const excludePattern =
      '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/out/**,**/target/**,**/vendor/**,**/.venv/**,**/bin/**,**/obj/**}';

    const files = await vscode.workspace.findFiles(includePattern, excludePattern, 2000);
    const newCache = new Map<string, DebugLogEntry[]>();
    const config = vscode.workspace.getConfiguration('devguard');
    const customPatterns = config.get<string[]>('customLogPatterns', []);

    for (const fileUri of files) {
      try {
        const fileBytes = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(fileBytes).toString('utf8');
        const lines = text.split('\n');
        const fileEntries: DebugLogEntry[] = [];
        const ext = path.extname(fileUri.fsPath).replace(/^\./, '').toLowerCase();
        const relPath = vscode.workspace.asRelativePath(fileUri);
        const normalized = path.normalize(fileUri.fsPath);
        const branchLines = this.branchAddedLinesCache.get(normalized);

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          const matched = matchDebugStatement(lineText, ext, customPatterns);
          if (matched) {
            fileEntries.push({
              uri: fileUri,
              relativePath: relPath,
              line: i,
              range: new vscode.Range(
                new vscode.Position(i, matched.startIndex),
                new vscode.Position(i, lineText.length)
              ),
              text: lineText.trim(),
              functionName: matched.functionName,
              isBranchOnly: branchLines ? branchLines.has(i) : false,
            });
          }
        }

        if (fileEntries.length > 0) {
          newCache.set(normalized, fileEntries);
        }
      } catch {
        // Skip unreadable files
      }
    }

    this.allRepoLogsCache = newCache;

    if (showNotification) {
      let total = 0;
      for (const entries of this.allRepoLogsCache.values()) {
        total += entries.length;
      }
      vscode.window.showInformationMessage(
        `DevGuard: Found ${total} debug statement(s) across ${this.allRepoLogsCache.size} file(s) in repository.`
      );
      // Focus sidebar
      vscode.commands.executeCommand('workbench.view.extension.devguard-view-container');
    }
  }

  /**
   * Returns log entries filtered by scope (Entire Repo vs Branch) and filename filter.
   */
  public getVisibleLogEntries(): Map<string, DebugLogEntry[]> {
    const result = new Map<string, DebugLogEntry[]>();

    for (const [filePath, entries] of this.allRepoLogsCache.entries()) {
      const relPath = entries[0]?.relativePath || path.basename(filePath);

      // Apply filename filter
      if (this.fileFilter) {
        const lowerFilter = this.fileFilter.toLowerCase();
        const matchesFilter =
          relPath.toLowerCase().includes(lowerFilter) ||
          path.basename(filePath).toLowerCase().includes(lowerFilter);
        if (!matchesFilter) continue;
      }

      // Apply scope filter
      const filtered = entries.filter((entry) => {
        if (this.currentScope === 'branchOnly') {
          return entry.isBranchOnly === true;
        }
        return true;
      });

      if (filtered.length > 0) {
        result.set(filePath, filtered);
      }
    }

    return result;
  }

  private updateStatusBar(count: number): void {
    const scopeLabel = this.currentScope === 'entireRepo' ? 'Repo' : 'Branch';
    if (count > 0) {
      this.statusBarItem.text = `$(trash) ${count} ${scopeLabel} logs`;
      this.statusBarItem.tooltip = `DevGuard: ${count} debug statement(s) found in ${scopeLabel}. Click to scan / clean.`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = `$(check) ${scopeLabel} Clean`;
      this.statusBarItem.tooltip = `DevGuard: No debug statements detected in ${scopeLabel}.`;
      this.statusBarItem.show();
    }
  }

  private decorateEditor(editor: vscode.TextEditor): number {
    const doc = editor.document;
    const normalizedPath = path.normalize(doc.uri.fsPath);
    const entries = this.allRepoLogsCache.get(normalizedPath) || [];

    const decorationOptions: vscode.DecorationOptions[] = entries.map((entry) => ({
      range: entry.range,
      hoverMessage: new vscode.MarkdownString(
        `🧹 **DevGuard:** Debug statement detected (\`${entry.functionName}\`). File: \`${entry.relativePath}:${entry.line + 1}\``
      ),
    }));

    editor.setDecorations(this.logDecorationType, decorationOptions);
    return entries.length;
  }

  /**
   * Filter the Debug Finder tree by file name or extension.
   */
  public async promptFilterByFilename(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: 'DevGuard: Filter Debug Finder by Filename',
      prompt: 'Enter search text or extension (e.g. sample, auth, .py, .ts)',
      value: this.fileFilter,
      placeHolder: 'e.g. auth, controller, sample.ts',
    });

    if (input !== undefined) {
      this.fileFilter = input.trim();
      this.treeDataProvider.refresh();
      const count = this.treeDataProvider.getTotalCount();
      vscode.window.showInformationMessage(
        this.fileFilter
          ? `DevGuard: Filtered to "${this.fileFilter}" (${count} debug statements found).`
          : 'DevGuard: Filter cleared. Showing all files.'
      );
    }
  }

  /**
   * Toggles scan scope between Entire Repository and Branch-Added Only.
   */
  public toggleScanScope(): void {
    this.currentScope = this.currentScope === 'entireRepo' ? 'branchOnly' : 'entireRepo';
    this.treeDataProvider.refresh();
    const count = this.treeDataProvider.getTotalCount();
    vscode.window.showInformationMessage(
      `DevGuard: Scope switched to ${this.currentScope === 'entireRepo' ? 'Entire Repository' : 'Branch Added Only'} (${count} found).`
    );
    this.updateStatusBar(count);
  }

  /**
   * Command: QuickPick list of all repository debug statements grouped by file.
   */
  public async cleanWorkspaceLogs(): Promise<void> {
    const visibleMap = this.getVisibleLogEntries();
    const allEntries: DebugLogEntry[] = [];
    for (const list of visibleMap.values()) {
      allEntries.push(...list);
    }

    if (allEntries.length === 0) {
      vscode.window.showInformationMessage('DevGuard: No debug statements detected in repository.');
      return;
    }

    interface LogQuickPickItem extends vscode.QuickPickItem {
      entry: DebugLogEntry;
    }

    const pickItems: LogQuickPickItem[] = allEntries.map((entry) => ({
      label: `$(file-code) [${path.basename(entry.uri.fsPath)}:${entry.line + 1}] ${entry.text}`,
      description: entry.relativePath,
      detail: `Type: ${entry.functionName} • Line: ${entry.line + 1}`,
      picked: true,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(pickItems, {
      canPickMany: true,
      title: `DevGuard: Clean Repository Debug Statements (${allEntries.length} found across ${visibleMap.size} files)`,
      placeHolder: 'Type file name to filter, or select statements to remove/comment out...',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected || selected.length === 0) return;

    await this.promptActionAndApply(selected.map((s) => s.entry));
  }

  /**
   * Command: Clean branch-added debug statements.
   */
  public async cleanBranchLogs(): Promise<void> {
    const branchEntries: DebugLogEntry[] = [];
    for (const list of this.allRepoLogsCache.values()) {
      for (const entry of list) {
        if (entry.isBranchOnly) {
          branchEntries.push(entry);
        }
      }
    }

    if (branchEntries.length === 0) {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const activeEntries = this.allRepoLogsCache.get(path.normalize(activeEditor.document.uri.fsPath)) || [];
        if (activeEntries.length > 0) {
          const action = await vscode.window.showInformationMessage(
            `DevGuard: No branch diff found. Found ${activeEntries.length} debug statement(s) in active file (${path.basename(activeEditor.document.fileName)}). Clean them?`,
            'Clean Active File Logs'
          );
          if (action === 'Clean Active File Logs') {
            await this.promptActionAndApply(activeEntries);
            return;
          }
        }
      }

      vscode.window.showInformationMessage('DevGuard: Clean! No branch-added debug logs detected.');
      return;
    }

    interface LogQuickPickItem extends vscode.QuickPickItem {
      entry: DebugLogEntry;
    }

    const pickItems: LogQuickPickItem[] = branchEntries.map((entry) => ({
      label: `$(trash) [${path.basename(entry.uri.fsPath)}:${entry.line + 1}] ${entry.text}`,
      description: entry.relativePath,
      detail: `Type: ${entry.functionName}`,
      picked: true,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(pickItems, {
      canPickMany: true,
      title: `DevGuard: Clean Branch Debug Statements (${branchEntries.length} found)`,
      placeHolder: 'Select debug statements to remove (Uncheck items to keep)',
    });

    if (!selected || selected.length === 0) return;
    await this.promptActionAndApply(selected.map((s) => s.entry));
  }

  private async promptActionAndApply(entries: DebugLogEntry[]): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(trash) Delete lines permanently',
          description: 'Completely remove the selected debug log lines',
          action: 'delete' as const,
        },
        {
          label: '$(comment) Comment out lines',
          description: 'Prefix with appropriate comment characters (//, #, etc.)',
          action: 'comment' as const,
        },
      ],
      {
        title: `DevGuard: Action for ${entries.length} Debug Statement(s)`,
        placeHolder: 'Delete permanently or comment out?',
      }
    );

    if (!choice) return;

    // Group by file URI and sort descending by line number
    const entriesByFile = new Map<string, DebugLogEntry[]>();
    for (const item of entries) {
      const key = item.uri.toString();
      if (!entriesByFile.has(key)) {
        entriesByFile.set(key, []);
      }
      entriesByFile.get(key)!.push(item);
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    let totalProcessed = 0;

    for (const [, fileEntries] of entriesByFile.entries()) {
      fileEntries.sort((a, b) => b.line - a.line);
      const uri = fileEntries[0].uri;
      const doc = await vscode.workspace.openTextDocument(uri);
      const commentPrefix = getCommentPrefix(doc.languageId);

      for (const entry of fileEntries) {
        const line = doc.lineAt(entry.line);
        if (choice.action === 'delete') {
          workspaceEdit.delete(uri, line.rangeIncludingLineBreak);
        } else {
          const indent = line.text.match(/^\s*/)?.[0] || '';
          const trimmed = line.text.substring(indent.length);
          const newLineText = `${indent}${commentPrefix}${trimmed}`;
          workspaceEdit.replace(uri, line.range, newLineText);
        }
        totalProcessed++;
      }
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied) {
      vscode.window.showInformationMessage(
        `DevGuard: ${choice.action === 'delete' ? 'Deleted' : 'Commented out'} ${totalProcessed} debug statement(s) across ${entriesByFile.size} file(s).`
      );
      this.refreshDecorations();
    } else {
      vscode.window.showErrorMessage('DevGuard: Failed to apply edits.');
    }
  }

  public async openLocation(entry: DebugLogEntry): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    await vscode.window.showTextDocument(doc, { selection: entry.range });
  }

  public async deleteLogNode(node: any): Promise<void> {
    if (node instanceof DebugLogTreeItem && node.entry) {
      const doc = await vscode.workspace.openTextDocument(node.entry.uri);
      const line = doc.lineAt(node.entry.line);
      const edit = new vscode.WorkspaceEdit();
      edit.delete(node.entry.uri, line.rangeIncludingLineBreak);
      await vscode.workspace.applyEdit(edit);
      this.refreshDecorations();
    } else if (node instanceof DebugFileTreeItem && node.entries) {
      await this.promptActionAndApply(node.entries);
    }
  }

  public async commentLogNode(node: any): Promise<void> {
    if (node instanceof DebugLogTreeItem && node.entry) {
      const doc = await vscode.workspace.openTextDocument(node.entry.uri);
      const line = doc.lineAt(node.entry.line);
      const commentPrefix = getCommentPrefix(doc.languageId);
      const indent = line.text.match(/^\s*/)?.[0] || '';
      const trimmed = line.text.substring(indent.length);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(node.entry.uri, line.range, `${indent}${commentPrefix}${trimmed}`);
      await vscode.workspace.applyEdit(edit);
      this.refreshDecorations();
    }
  }

  public async transformLogs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('DevGuard: Open a source file to transform debug statements.');
      return;
    }

    const doc = editor.document;
    const entries = this.allRepoLogsCache.get(path.normalize(doc.uri.fsPath)) || [];
    if (entries.length === 0) {
      vscode.window.showInformationMessage('DevGuard: No debug statements detected in active file.');
      return;
    }

    const transformation = await vscode.window.showQuickPick(
      [
        {
          label: '$(symbol-method) Convert to Structured Logger (logger.debug)',
          description: 'Replaces console.log(...) with logger.debug(...)',
          type: 'structured' as const,
        },
        {
          label: '$(info) Convert to console.debug',
          description: 'Replaces console.log(...) with console.debug(...)',
          type: 'debug' as const,
        },
        {
          label: '$(shield) Wrap with Development Guard',
          description: 'Wraps with: if (process.env.NODE_ENV !== "production")',
          type: 'guard' as const,
        },
      ],
      {
        title: `DevGuard: Transform ${entries.length} Debug Log(s)`,
        placeHolder: 'Select log transformation style',
      }
    );

    if (!transformation) return;

    entries.sort((a, b) => b.line - a.line);
    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const entry of entries) {
      const line = doc.lineAt(entry.line);
      const indent = line.text.match(/^\s*/)?.[0] || '';
      const trimmed = line.text.trim();

      let transformedLine = line.text;

      if (transformation.type === 'structured') {
        transformedLine = line.text.replace(/\bconsole\.(?:log|warn|info)\s*\(/, 'logger.debug(');
      } else if (transformation.type === 'debug') {
        transformedLine = line.text.replace(/\bconsole\.log\s*\(/, 'console.debug(');
      } else if (transformation.type === 'guard') {
        const isPython = doc.languageId === 'python';
        if (isPython) {
          transformedLine = `${indent}if os.getenv("ENV") != "production":\n${indent}    ${trimmed}`;
        } else {
          transformedLine = `${indent}if (process.env.NODE_ENV !== 'production') {\n${indent}  ${trimmed}\n${indent}}`;
        }
      }

      workspaceEdit.replace(doc.uri, line.range, transformedLine);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied) {
      vscode.window.showInformationMessage(
        `DevGuard: Transformed ${entries.length} debug statement(s).`
      );
      this.refreshDecorations();
    }
  }

  public dispose(): void {
    this.logDecorationType.dispose();
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * File Group Node in Debug Finder TreeView.
 */
class DebugFileTreeItem extends vscode.TreeItem {
  constructor(public readonly filePath: string, public readonly entries: DebugLogEntry[]) {
    const fileName = path.basename(filePath);
    const dirName = path.dirname(entries[0]?.relativePath || filePath);

    super(fileName, vscode.TreeItemCollapsibleState.Expanded);

    this.description = `${dirName} (${entries.length})`;
    this.tooltip = `${entries[0]?.relativePath} — ${entries.length} debug statement(s)`;
    this.iconPath = vscode.ThemeIcon.File;
    this.contextValue = 'debugFileGroup';
  }
}

/**
 * Individual Log Statement Node in Debug Finder TreeView.
 */
class DebugLogTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: DebugLogEntry) {
    const label = `Line ${entry.line + 1}: ${entry.text}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = `[${entry.functionName}]`;
    this.tooltip = new vscode.MarkdownString(
      `**Location:** \`${entry.relativePath}:${entry.line + 1}\`\n\n\`\`\`\n${entry.text}\n\`\`\``
    );
    this.iconPath = new vscode.ThemeIcon('symbol-property', new vscode.ThemeColor('editorWarning.foreground'));
    this.contextValue = 'debugLogItem';

    this.command = {
      command: 'devguard.openLogLocation',
      title: 'Jump to Debug Statement',
      arguments: [entry],
    };
  }
}

/**
 * TreeDataProvider for rendering repository debug statements grouped by file.
 */
class DebugFinderTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly getVisibleLogs: () => Map<string, DebugLogEntry[]>,
    private readonly getScope: () => ScanScope,
    private readonly getFilter: () => string
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTotalCount(): number {
    let total = 0;
    for (const list of this.getVisibleLogs().values()) {
      total += list.length;
    }
    return total;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
      // Root level: list of files
      const visibleMap = this.getVisibleLogs();
      const fileNodes: DebugFileTreeItem[] = [];

      for (const [filePath, entries] of visibleMap.entries()) {
        fileNodes.push(new DebugFileTreeItem(filePath, entries));
      }

      // Sort files alphabetically by relative path
      fileNodes.sort((a, b) => a.filePath.localeCompare(b.filePath));

      if (fileNodes.length === 0) {
        const scope = this.getScope() === 'entireRepo' ? 'entire repository' : 'current branch';
        const filter = this.getFilter();
        const msg = filter
          ? `No debug statements matching "${filter}"`
          : `Clean! No debug statements found in ${scope}`;
        const emptyItem = new vscode.TreeItem(msg, vscode.TreeItemCollapsibleState.None);
        emptyItem.iconPath = new vscode.ThemeIcon('check');
        return Promise.resolve([emptyItem]);
      }

      return Promise.resolve(fileNodes);
    }

    if (element instanceof DebugFileTreeItem) {
      // Second level: list of logs in this file
      const logNodes = element.entries.map((entry) => new DebugLogTreeItem(entry));
      logNodes.sort((a, b) => a.entry.line - b.entry.line);
      return Promise.resolve(logNodes);
    }

    return Promise.resolve([]);
  }
}
