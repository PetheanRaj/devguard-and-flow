import * as vscode from 'vscode';
import { ClipboardItem } from '../types';

const STORAGE_KEY = 'devguard.clipboardRing';

export class ClipboardRingFeature implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private treeDataProvider: ClipboardTreeDataProvider;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.treeDataProvider = new ClipboardTreeDataProvider(this.context, () => this.getHistory());

    // Register TreeView in VS Code Side Bar
    this.disposables.push(
      vscode.window.registerTreeDataProvider('devguard.clipboardView', this.treeDataProvider)
    );

    // Register Commands
    this.disposables.push(
      vscode.commands.registerCommand('devguard.copy', () => this.handleCopy()),
      vscode.commands.registerCommand('devguard.cut', () => this.handleCut()),
      vscode.commands.registerCommand('devguard.showClipboardHistory', () =>
        this.showClipboardHistory()
      ),
      vscode.commands.registerCommand('devguard.pinClip', (item?: ClipboardTreeItem | ClipboardItem) =>
        this.togglePin(item)
      ),
      vscode.commands.registerCommand('devguard.deleteClip', (item?: ClipboardTreeItem) =>
        this.deleteItem(item)
      ),
      vscode.commands.registerCommand('devguard.pasteClip', (text: string) =>
        this.pasteWithSmartIndent(text)
      )
    );
  }

  private async handleCopy(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      const selectedText = editor.document.getText(editor.selection);
      await this.recordSnippet(selectedText, editor);
    }
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
  }

  private async handleCut(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      const selectedText = editor.document.getText(editor.selection);
      await this.recordSnippet(selectedText, editor);
    }
    await vscode.commands.executeCommand('editor.action.clipboardCutAction');
  }

  private async recordSnippet(text: string, editor: vscode.TextEditor): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const doc = editor.document;
    const relPath = vscode.workspace.asRelativePath(doc.uri);
    const lineNumber = editor.selection.start.line + 1;

    const newItem: ClipboardItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      text,
      relativePath: relPath,
      fullPath: doc.uri.fsPath,
      lineNumber,
      languageId: doc.languageId,
      timestamp: Date.now(),
      isPinned: false,
    };

    const config = vscode.workspace.getConfiguration('devguard');
    const maxSize = config.get<number>('clipboardRingSize', 20);

    const history = this.getHistory();
    const existing = history.find((i) => i.text === text);
    const wasPinned = existing?.isPinned || false;
    newItem.isPinned = wasPinned;

    const filtered = history.filter((item) => item.text !== text);
    // Keep pinned items at top, followed by newest
    const pinned = filtered.filter((i) => i.isPinned);
    const unpinned = filtered.filter((i) => !i.isPinned);

    const updated = newItem.isPinned
      ? [newItem, ...pinned, ...unpinned].slice(0, maxSize)
      : [...pinned, newItem, ...unpinned].slice(0, maxSize);

    await this.context.workspaceState.update(STORAGE_KEY, updated);
    this.treeDataProvider.refresh();
  }

  private getHistory(): ClipboardItem[] {
    return this.context.workspaceState.get<ClipboardItem[]>(STORAGE_KEY, []);
  }

  public async showClipboardHistory(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('DevGuard: Open an editor to paste from clipboard history.');
      return;
    }

    const history = this.getHistory();
    if (history.length === 0) {
      vscode.window.showInformationMessage('DevGuard: Workspace clipboard history is empty.');
      return;
    }

    interface ClipboardQuickPickItem extends vscode.QuickPickItem {
      item?: ClipboardItem;
      isClearAction?: boolean;
    }

    const pickItems: ClipboardQuickPickItem[] = history.map((item) => {
      const lines = item.text.split('\n');
      const firstLine = lines[0].trim();
      const pinPrefix = item.isPinned ? '⭐ ' : '';
      const label = `${pinPrefix}$(clippy) ${firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine}`;
      const lineCountStr = lines.length > 1 ? ` (${lines.length} lines)` : '';
      const timeStr = this.formatRelativeTime(item.timestamp);

      return {
        label,
        description: `${item.relativePath}:${item.lineNumber} [${item.languageId}]${lineCountStr}`,
        detail: `${timeStr} — "${lines.slice(0, 3).map((l) => l.trim()).join(' ↵ ')}"`,
        item,
      };
    });

    pickItems.push({
      label: '$(clear-all) Clear Workspace Clipboard History',
      description: 'Purge all stored clips for this workspace (except pinned)',
      isClearAction: true,
    });

    const chosen = await vscode.window.showQuickPick(pickItems, {
      title: `DevGuard: Clipboard Ring (${history.length} items)`,
      placeHolder: 'Select a snippet to insert at cursor position with smart indentation...',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!chosen) return;

    if (chosen.isClearAction) {
      const preserved = history.filter((i) => i.isPinned);
      await this.context.workspaceState.update(STORAGE_KEY, preserved);
      this.treeDataProvider.refresh();
      vscode.window.showInformationMessage('DevGuard: Unpinned clipboard history cleared.');
      return;
    }

    if (chosen.item) {
      await this.pasteWithSmartIndent(chosen.item.text);
    }
  }

  /**
   * Smart Indentation Paste: Adjusts multi-line indentation to match cursor position.
   */
  public async pasteWithSmartIndent(rawText: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    const lines = rawText.split('\n');

    await editor.edit((editBuilder) => {
      for (const selection of editor.selections) {
        if (lines.length === 1) {
          if (selection.isEmpty) {
            editBuilder.insert(selection.active, rawText);
          } else {
            editBuilder.replace(selection, rawText);
          }
          continue;
        }

        // Multi-line smart indent
        const lineAtCursor = doc.lineAt(selection.start.line);
        const cursorIndent = lineAtCursor.text.substring(0, selection.start.character).match(/^\s*/)?.[0] || '';

        // Determine base indent of source snippet
        const firstLineIndent = lines[0].match(/^\s*/)?.[0] || '';
        const adjustedLines = lines.map((l, idx) => {
          if (idx === 0) return l.substring(firstLineIndent.length);
          if (l.startsWith(firstLineIndent)) {
            return cursorIndent + l.substring(firstLineIndent.length);
          }
          return cursorIndent + l.trimStart();
        });

        const indentedText = adjustedLines.join('\n');
        if (selection.isEmpty) {
          editBuilder.insert(selection.active, indentedText);
        } else {
          editBuilder.replace(selection, indentedText);
        }
      }
    });
  }

  public async togglePin(target?: ClipboardTreeItem | ClipboardItem): Promise<void> {
    const item = target instanceof ClipboardTreeItem ? target.clipItem : target;
    if (!item) return;

    const history = this.getHistory();
    const updated = history.map((c) => (c.id === item.id ? { ...c, isPinned: !c.isPinned } : c));
    await this.context.workspaceState.update(STORAGE_KEY, updated);
    this.treeDataProvider.refresh();
  }

  public async deleteItem(treeItem?: ClipboardTreeItem): Promise<void> {
    if (!treeItem) return;
    const history = this.getHistory();
    const updated = history.filter((c) => c.id !== treeItem.clipItem.id);
    await this.context.workspaceState.update(STORAGE_KEY, updated);
    this.treeDataProvider.refresh();
  }

  private formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);

    if (diffSec < 45) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * Tree item representing a clipboard snippet in the Sidebar.
 */
class ClipboardTreeItem extends vscode.TreeItem {
  constructor(public readonly clipItem: ClipboardItem) {
    const firstLine = clipItem.text.split('\n')[0].trim();
    const label = firstLine.length > 35 ? firstLine.substring(0, 32) + '...' : firstLine;

    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = `${clipItem.relativePath}:${clipItem.lineNumber}`;
    this.tooltip = new vscode.MarkdownString(
      `**Source:** \`${clipItem.relativePath}:${clipItem.lineNumber}\` (${clipItem.languageId})\n\n\`\`\`${clipItem.languageId}\n${clipItem.text}\n\`\`\``
    );

    this.iconPath = clipItem.isPinned
      ? new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.yellow'))
      : new vscode.ThemeIcon('clippy');

    this.contextValue = clipItem.isPinned ? 'pinnedClip' : 'unpinnedClip';

    this.command = {
      command: 'devguard.pasteClip',
      title: 'Paste Clip at Cursor',
      arguments: [clipItem.text],
    };
  }
}

/**
 * TreeDataProvider for rendering clipboard clips in the VS Code Activity Bar.
 */
class ClipboardTreeDataProvider implements vscode.TreeDataProvider<ClipboardTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ClipboardTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getHistory: () => ClipboardItem[]
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ClipboardTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: ClipboardTreeItem): Thenable<ClipboardTreeItem[]> {
    const items = this.getHistory();
    // Pinned clips first, then chronological
    const sorted = [...items].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.timestamp - a.timestamp;
    });

    return Promise.resolve(sorted.map((item) => new ClipboardTreeItem(item)));
  }
}
