import * as vscode from 'vscode';

/**
 * Metadata stored for each snippet in the scoped clipboard ring.
 */
export interface ClipboardItem {
  id: string;
  text: string;
  relativePath: string;
  fullPath: string;
  lineNumber: number;
  languageId: string;
  timestamp: number;
  isPinned?: boolean;
}

/**
 * Representation of a detected debug log statement.
 */
export interface DebugLogEntry {
  uri: vscode.Uri;
  relativePath: string;
  line: number;
  range: vscode.Range;
  text: string;
  functionName: string;
  isBranchOnly?: boolean;
}

/**
 * Diagnostic secret match result with entropy analysis.
 */
export interface SecretFinding {
  range: vscode.Range;
  ruleName: string;
  matchedText: string;
  entropy?: number;
}

/**
 * Plain-English token breakdown for regex patterns.
 */
export interface RegexTokenExplanation {
  raw: string;
  category: 'anchor' | 'quantifier' | 'charset' | 'group' | 'flag' | 'escape' | 'literal';
  explanation: string;
}
