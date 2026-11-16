import * as vscode from 'vscode';
import cronstrue from 'cronstrue';
import {
  findRegexLiterals,
  findCronExpressions,
  buildRegexMarkdown,
  explainRegexTokens,
  RegexMatchResult,
} from '../utils/regexParser';
import { getNextCronRuns, formatUpcomingDates } from '../utils/cronCalculator';

const SUPPORTED_LANGUAGES: vscode.DocumentSelector = [
  { language: 'javascript' },
  { language: 'typescript' },
  { language: 'javascriptreact' },
  { language: 'typescriptreact' },
  { language: 'python' },
  { language: 'yaml' },
  { language: 'json' },
  { language: 'go' },
];

export class TranslatorLensFeature implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private codeLensEmitter = new vscode.EventEmitter<void>();

  constructor(private readonly context: vscode.ExtensionContext) {
    // Register Hover Provider
    this.disposables.push(
      vscode.languages.registerHoverProvider(
        SUPPORTED_LANGUAGES,
        new TranslatorHoverProvider()
      )
    );

    // Register CodeLens Provider
    const codeLensProvider = new TranslatorCodeLensProvider(this.codeLensEmitter);
    this.disposables.push(
      vscode.languages.registerCodeLensProvider(SUPPORTED_LANGUAGES, codeLensProvider)
    );

    // Register Commands
    this.disposables.push(
      vscode.commands.registerCommand(
        'devguard.showTranslationDetails',
        (title: string, details: string) => {
          vscode.window.showInformationMessage(title, { modal: true, detail: details });
        }
      ),
      vscode.commands.registerCommand('devguard.testRegex', (initialPattern?: string, flags?: string) =>
        this.runInteractiveRegexTester(initialPattern, flags)
      )
    );

    // Listen to configuration changes to refresh CodeLens
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('devguard.enableCodeLens')) {
          this.codeLensEmitter.fire();
        }
      })
    );
  }

  /**
   * Interactive In-Editor Regex Tester.
   */
  public async runInteractiveRegexTester(initialPattern?: string, flags: string = 'g'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let pattern = initialPattern;

    if (!pattern && editor) {
      const selected = editor.document.getText(editor.selection).trim();
      if (selected.startsWith('/') && selected.lastIndexOf('/') > 0) {
        const lastSlash = selected.lastIndexOf('/');
        pattern = selected.substring(1, lastSlash);
        flags = selected.substring(lastSlash + 1) || 'g';
      } else if (selected.length > 0) {
        pattern = selected;
      }
    }

    if (!pattern) {
      pattern = await vscode.window.showInputBox({
        title: 'DevGuard: Interactive Regex Tester',
        prompt: 'Enter regex pattern (without enclosing slashes)',
        placeHolder: 'e.g. ^[a-z0-9_-]{3,16}$',
      });
      if (!pattern) return;
    }

    let regexObj: RegExp;
    try {
      regexObj = new RegExp(pattern, flags);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Invalid regular expression: ${err.message}`);
      return;
    }

    const testInput = vscode.window.createInputBox();
    testInput.title = `Testing Regex: /${pattern}/${flags}`;
    testInput.placeholder = 'Type test string here to check matches in real-time...';
    testInput.prompt = 'Live match indicator will update as you type.';

    testInput.onDidChangeValue((value) => {
      if (!value) {
        testInput.prompt = 'Enter a string to test against the pattern.';
        return;
      }

      regexObj.lastIndex = 0;
      const isMatch = regexObj.test(value);

      if (isMatch) {
        regexObj.lastIndex = 0;
        const matches = [...value.matchAll(regexObj)];
        const matchCount = matches.length;
        testInput.prompt = `✅ MATCH! Found ${matchCount} occurrence(s). First match: "${matches[0][0]}"`;
      } else {
        testInput.prompt = `❌ NO MATCH against /${pattern}/${flags}`;
      }
    });

    testInput.onDidAccept(() => testInput.dispose());
    testInput.show();
  }

  public dispose(): void {
    this.codeLensEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * Hover Provider that renders markdown explanations and upcoming run times.
 */
class TranslatorHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // 1. Check for Cron Expressions
    const cronMatches = findCronExpressions(lineText);
    for (const match of cronMatches) {
      if (position.character >= match.index && position.character <= match.index + match.length) {
        let plainEnglish = '';
        try {
          plainEnglish = cronstrue.toString(match.expression, {
            throwExceptionOnParseError: true,
            verbose: true,
          });
        } catch {
          continue;
        }

        const nextRuns = getNextCronRuns(match.expression, 5);
        const nextRunsMarkdown = formatUpcomingDates(nextRuns);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`### ⏰ DevGuard Cron Translator\n\n`);
        md.appendMarkdown(`**Schedule:** \`${match.expression}\`\n\n`);
        md.appendMarkdown(`> **${plainEnglish}**\n\n`);
        md.appendMarkdown(`#### 📅 Next 5 Upcoming Runs (Local Time):\n\n`);
        md.appendMarkdown(`${nextRunsMarkdown}\n\n`);
        md.appendMarkdown(`---\n*Field format: \`minute hour day-of-month month day-of-week [year]\`*`);

        const range = new vscode.Range(
          new vscode.Position(position.line, match.index),
          new vscode.Position(position.line, match.index + match.length)
        );

        return new vscode.Hover(md, range);
      }
    }

    // 2. Check for Regex Literals
    const regexMatches = findRegexLiterals(lineText);
    for (const match of regexMatches) {
      if (position.character >= match.index && position.character <= match.index + match.length) {
        const mdText = buildRegexMarkdown(match.pattern, match.flags);
        const md = new vscode.MarkdownString(mdText);
        md.isTrusted = true;

        md.appendMarkdown(`\n\n[▶ Test this regex interactively](command:devguard.testRegex?${encodeURIComponent(JSON.stringify([match.pattern, match.flags]))})`);

        const range = new vscode.Range(
          new vscode.Position(position.line, match.index),
          new vscode.Position(position.line, match.index + match.length)
        );

        return new vscode.Hover(md, range);
      }
    }

    return null;
  }
}

/**
 * CodeLens Provider displaying high-level plain-English summary directly above code.
 */
class TranslatorCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly onDidChangeEmitter: vscode.EventEmitter<void>) {}

  public get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeEmitter.event;
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration('devguard');
    const enabled = config.get<boolean>('enableCodeLens', true);
    if (!enabled) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const lineCount = document.lineCount;

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      // Cron CodeLens
      const cronMatches = findCronExpressions(text);
      for (const cm of cronMatches) {
        try {
          const explanation = cronstrue.toString(cm.expression, {
            throwExceptionOnParseError: true,
            verbose: false,
          });

          const nextRuns = getNextCronRuns(cm.expression, 3);
          const nextRunsFormatted = formatUpcomingDates(nextRuns);

          const range = new vscode.Range(i, cm.index, i, cm.index + cm.length);
          const lens = new vscode.CodeLens(range, {
            title: `$(calendar) Cron: "${explanation}"`,
            tooltip: `Cron Schedule: ${cm.expression}\nClick to view next run times`,
            command: 'devguard.showTranslationDetails',
            arguments: [
              `Cron Schedule: ${cm.expression}`,
              `Plain-English Schedule:\n\n${explanation}\n\nUpcoming executions:\n${nextRunsFormatted}`,
            ],
          });
          lenses.push(lens);
        } catch {
          // Skip invalid
        }
      }

      // Regex CodeLens
      const regexMatches = findRegexLiterals(text);
      for (const rm of regexMatches) {
        const tokens = explainRegexTokens(rm.pattern, rm.flags);
        const summary = this.createShortRegexSummary(tokens);

        const range = new vscode.Range(i, rm.index, i, rm.index + rm.length);
        const lens = new vscode.CodeLens(range, {
          title: `$(regex) Regex: ${summary}`,
          tooltip: `Regex Pattern: /${rm.pattern}/${rm.flags}\nClick to test interactively`,
          command: 'devguard.testRegex',
          arguments: [rm.pattern, rm.flags],
        });
        lenses.push(lens);
      }
    }

    return lenses;
  }

  private createShortRegexSummary(tokens: ReturnType<typeof explainRegexTokens>): string {
    if (tokens.length === 0) {
      return 'Literal pattern';
    }
    const charsets = tokens.filter((t) => t.category === 'charset').map((t) => t.raw);
    const quantifiers = tokens.filter((t) => t.category === 'quantifier').map((t) => t.raw);

    if (charsets.length > 0) {
      const q = quantifiers.length > 0 ? ` (${quantifiers.join(', ')})` : '';
      return `Matches ${charsets.slice(0, 2).join(' ')}${q}`;
    }

    return `Tokens: ${tokens.slice(0, 3).map((t) => t.raw).join(' ')}`;
  }
}
