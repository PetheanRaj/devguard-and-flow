import * as vscode from 'vscode';
import * as path from 'path';
import { getBranchAddedLines } from '../utils/git';
import { debounce } from '../utils/debounce';
import { matchDebugStatement, getCommentPrefix } from '../utils/debugPatterns';
import { DebugLogEntry } from '../types';

export class LogCleanerFeature implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private logDecorationType: vscode.TextEditorDecorationType;
  private statusBarItem: vscode.StatusBarItem;
  private branchAddedLinesCache = new Map<string, Set<number>>();
  private totalDetectedLogs: number = 0;

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

    // Status Bar Cleanliness Counter
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.statusBarItem.command = 'devguard.cleanBranchLogs';
    this.disposables.push(this.statusBarItem);

    // Register Commands
    this.disposables.push(
      vscode.commands.registerCommand('devguard.cleanBranchLogs', () => this.cleanBranchLogs()),
      vscode.commands.registerCommand('devguard.transformLogs', () => this.transformLogs())
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
   * Refreshes the git diff cache, status bar counter, and applies decorations.
   */
  public async refreshDecorations(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      let activeCount = 0;
      for (const editor of vscode.window.visibleTextEditors) {
        activeCount += this.decorateEditor(editor);
      }
      this.updateStatusBar(activeCount);
      return;
    }

    const config = vscode.workspace.getConfiguration('devguard');
    const baseBranch = config.get<string>('baseBranch', 'main');

    // Refresh diff for all workspace folders
    for (const folder of folders) {
      const addedLinesMap = await getBranchAddedLines(folder.uri.fsPath, baseBranch);
      for (const [filePath, lineSet] of addedLinesMap.entries()) {
        this.branchAddedLinesCache.set(path.normalize(filePath), lineSet);
      }
    }

    let detectedCount = 0;
    for (const editor of vscode.window.visibleTextEditors) {
      const count = this.decorateEditor(editor);
      detectedCount += count;
    }

    this.totalDetectedLogs = detectedCount;
    this.updateStatusBar(detectedCount);
  }

  private updateStatusBar(count: number): void {
    if (count > 0) {
      this.statusBarItem.text = `$(trash) ${count} debug log${count > 1 ? 's' : ''}`;
      this.statusBarItem.tooltip = `DevGuard: ${count} debug statement(s) detected. Click to clean or comment out.`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = '$(check) Logs Clean';
      this.statusBarItem.tooltip = 'DevGuard: No debug statements detected.';
      this.statusBarItem.show();
    }
  }

  /**
   * Decorates debug statements in a specific editor and returns the number found.
   */
  private decorateEditor(editor: vscode.TextEditor): number {
    const doc = editor.document;
    const normalizedPath = path.normalize(doc.uri.fsPath);
    const addedLines = this.branchAddedLinesCache.get(normalizedPath);

    const debugEntries = this.scanDebugLogsInDocument(
      doc,
      addedLines && addedLines.size > 0 ? addedLines : undefined
    );

    const decorationOptions: vscode.DecorationOptions[] = debugEntries.map((entry) => ({
      range: entry.range,
      hoverMessage: new vscode.MarkdownString(
        addedLines && addedLines.has(entry.line)
          ? `🧹 **DevGuard:** Branch-added debug statement (\`${entry.functionName}\` [${doc.languageId}]).`
          : `🧹 **DevGuard:** Debug statement detected (\`${entry.functionName}\` [${doc.languageId}]).`
      ),
    }));

    editor.setDecorations(this.logDecorationType, decorationOptions);
    return debugEntries.length;
  }

  /**
   * Scans a document for debug statements across all languages.
   */
  private scanDebugLogsInDocument(
    doc: vscode.TextDocument,
    addedLines?: Set<number>
  ): DebugLogEntry[] {
    const entries: DebugLogEntry[] = [];
    const lineCount = doc.lineCount;

    const config = vscode.workspace.getConfiguration('devguard');
    const customPatterns = config.get<string[]>('customLogPatterns', []);

    for (let i = 0; i < lineCount; i++) {
      if (addedLines && !addedLines.has(i)) {
        continue;
      }

      const line = doc.lineAt(i);
      const text = line.text;

      const matched = matchDebugStatement(text, doc.languageId, customPatterns);
      if (matched) {
        entries.push({
          uri: doc.uri,
          line: i,
          range: new vscode.Range(
            new vscode.Position(i, matched.startIndex),
            new vscode.Position(i, line.text.length)
          ),
          text: text.trim(),
          functionName: matched.functionName,
        });
      }
    }

    return entries;
  }

  /**
   * Command: QuickPick list of debug statements for batch removal or commenting out.
   */
  public async cleanBranchLogs(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const config = vscode.workspace.getConfiguration('devguard');
    const baseBranch = config.get<string>('baseBranch', 'main');

    if (folders && folders.length > 0) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'DevGuard: Scanning for multi-language debug statements...',
          cancellable: false,
        },
        async () => {
          for (const folder of folders) {
            const addedLinesMap = await getBranchAddedLines(folder.uri.fsPath, baseBranch);
            for (const [filePath, lineSet] of addedLinesMap.entries()) {
              this.branchAddedLinesCache.set(path.normalize(filePath), lineSet);
            }
          }
        }
      );
    }

    const allEntries: DebugLogEntry[] = [];
    for (const [filePath, lineSet] of this.branchAddedLinesCache.entries()) {
      try {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const fileEntries = this.scanDebugLogsInDocument(doc, lineSet);
        allEntries.push(...fileEntries);
      } catch {}
    }

    if (allEntries.length === 0) {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const fileEntries = this.scanDebugLogsInDocument(activeEditor.document);
        if (fileEntries.length > 0) {
          const action = await vscode.window.showInformationMessage(
            `DevGuard: No branch diff found against "${baseBranch}". Found ${fileEntries.length} debug statement(s) in active file (${path.basename(activeEditor.document.fileName)}). Clean them?`,
            'Clean Active File Logs'
          );
          if (action === 'Clean Active File Logs') {
            await this.promptAndCleanEntries(fileEntries, path.basename(activeEditor.document.fileName));
            return;
          }
        }
      }

      vscode.window.showInformationMessage(
        `DevGuard: Clean! No debug statements detected against base branch "${baseBranch}".`
      );
      return;
    }

    await this.promptAndCleanEntries(allEntries, `Branch (${baseBranch})`);
  }

  /**
   * Displays QuickPick for user confirmation and executes batch deletion or commenting.
   */
  private async promptAndCleanEntries(entries: DebugLogEntry[], contextLabel: string): Promise<void> {
    interface LogQuickPickItem extends vscode.QuickPickItem {
      entry: DebugLogEntry;
    }

    const pickItems: LogQuickPickItem[] = entries.map((entry) => {
      const relPath = vscode.workspace.asRelativePath(entry.uri);
      return {
        label: `$(trash) ${entry.text}`,
        description: `${relPath}:${entry.line + 1}`,
        detail: `Type: ${entry.functionName}`,
        picked: true,
        entry,
      };
    });

    const selected = await vscode.window.showQuickPick(pickItems, {
      canPickMany: true,
      title: `DevGuard: Clean Debug Statements [${contextLabel}] (${entries.length} found)`,
      placeHolder: 'Select debug statements to handle (Uncheck items you wish to keep)',
    });

    if (!selected || selected.length === 0) {
      return;
    }

    // Ask user whether to DELETE or COMMENT OUT
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(trash) Delete lines permanently',
          description: 'Completely remove the selected debug log lines',
          action: 'delete' as const,
        },
        {
          label: '$(comment) Comment out lines',
          description: 'Prefix with language-appropriate comment characters (//, #, etc.)',
          action: 'comment' as const,
        },
      ],
      {
        title: `DevGuard: Choose Cleanup Action for ${selected.length} Item(s)`,
        placeHolder: 'Delete permanently or comment out?',
      }
    );

    if (!choice) return;

    // Group by file URI and sort descending by line number
    const entriesByFile = new Map<string, DebugLogEntry[]>();
    for (const item of selected) {
      const key = item.entry.uri.toString();
      if (!entriesByFile.has(key)) {
        entriesByFile.set(key, []);
      }
      entriesByFile.get(key)!.push(item.entry);
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
          // Comment out
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
      vscode.window.showErrorMessage('DevGuard: Failed to apply edits to debug logs.');
    }
  }

  /**
   * Transforms console.log / print statements into structured logger or dev-guarded blocks.
   */
  public async transformLogs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('DevGuard: Open a source file to transform debug statements.');
      return;
    }

    const doc = editor.document;
    const entries = this.scanDebugLogsInDocument(doc);
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
