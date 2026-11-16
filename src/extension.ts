import * as vscode from 'vscode';
import { SecretGuardFeature } from './features/secretGuard';
import { LogCleanerFeature } from './features/logCleaner';
import { TranslatorLensFeature } from './features/translatorLens';
import { ClipboardRingFeature } from './features/clipboardRing';

/**
 * Extension activation lifecycle entry point.
 * Initializes all four modular feature slices cleanly into context.subscriptions.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('[DevGuard & Flow] Initializing extension features...');

  try {
    // Feature A: Smart .env & Secret Guard
    const secretGuard = new SecretGuardFeature(context);
    context.subscriptions.push(secretGuard);

    // Feature B: Context-Aware Console Log Cleaner
    const logCleaner = new LogCleanerFeature(context);
    context.subscriptions.push(logCleaner);

    // Feature C: Regex & Cron Translator Lens
    const translatorLens = new TranslatorLensFeature(context);
    context.subscriptions.push(translatorLens);

    // Feature D: Scoped Clipboard History Ring
    const clipboardRing = new ClipboardRingFeature(context);
    context.subscriptions.push(clipboardRing);

    console.log('[DevGuard & Flow] All 4 core features registered successfully.');
  } catch (error) {
    console.error('[DevGuard & Flow] Activation error:', error);
    vscode.window.showErrorMessage(
      `[DevGuard & Flow] Failed to initialize features: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extension deactivation lifecycle hook.
 * Disposables registered in context.subscriptions are automatically disposed by VS Code.
 */
export function deactivate(): void {
  console.log('[DevGuard & Flow] Extension deactivated cleanly.');
}
