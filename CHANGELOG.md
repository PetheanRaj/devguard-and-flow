# Changelog

All notable changes to the **DevGuard Flow Suite** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-11-16

### Added
- **Repository-Wide Debug Statement Finder:** Fast asynchronous scanner searching all files across the repository for debug logs.
- **Dedicated Debug Finder TreeView in Activity Bar:** File-grouped explorer (`devguard.debugFinderView`) listing debug statements by filename, line number, and function type.
- **Click-to-Jump Navigation:** Clicking any debug log in the tree opens the file and highlights the exact line and position in the editor.
- **Filter by Filename / Path:** Search box to filter debug statements by file name or extension (e.g. `*.py`, `auth`, `api`).
- **Scope Toggle:** Seamlessly switch between scanning the **Entire Repository** or **Current Branch Added Only**.
- **Workspace Batch Cleaner:** QuickPick preview matching by filename to batch delete or comment out debug statements across the repository.

---

## [0.2.3] - 2026-11-16

### Added
- **Safe Mock Data Generator for `.env`:** One-click generation of safe local development credentials (`devguard.generateMockEnvValues`).
- **Log Transformer:** Interactively converts raw debug prints into structured loggers (`logger.debug(...)`), development environment guards (`if (process.env.NODE_ENV !== 'production')`), or `console.debug()`.
- **Multi-Language Debug Statement Engine:** Comprehensive support for 20+ programming languages (Python, Java, Kotlin, Go, Rust, C++, C#, PHP, Swift, Ruby, etc.) with language-aware comment prefixes.
- **SVG Activity Bar Branding:** Resolution-independent monochrome vector icon for the VS Code Side Bar.

---

## [0.2.0] - 2026-11-16

### Added
- **Pre-Commit Secret Guard Hook:** Command to install `.git/hooks/pre-commit` to prevent committing `.env` files or exposed tokens.
- **Multi-Environment Diff View:** Side-by-side Markdown comparison between `.env.local`, `.env.production`, or any two environment files.
- **Next 5 Runs Calculator:** Hovering over any cron schedule calculates the next 5 upcoming executions in local time.
- **Interactive Regex Tester:** Real-time in-editor input box with live match testing and capture group previews.
- **Sidebar TreeView for Clipboard Ring:** Native Activity Bar view with snippet previews and ⭐ pin favorites support.
- **Smart Indentation on Paste:** Multi-line clipboard pastes auto-align with destination indentation.
- **Comment-Out vs. Delete Option:** Choice to comment out debug statements instead of deleting them.

---

## [0.1.0] - 2026-11-16

### Added
- **Demo Mode Masking:** Single-click status bar toggle hiding `.env` values (`••••••••••••••••`) during screen-sharing without disk modifications.
- **Hardcoded Secret Scanner:** Real-time Shannon entropy and regex detection for AWS keys, Stripe keys, GitHub PATs, JWTs, and private keys.
- **`.env` vs `.env.example` Auto-Sync:** Diagnostics and QuickFix to keep environment templates synchronized.
- **Branch-Aware Console Log Cleaner:** Git diff integration targeting newly added debug statements.
- **Regex & Cron Translator Lens:** Plain-English hover breakdowns and CodeLens summaries using `cronstrue`.
- **Scoped Clipboard Ring:** 20-slot isolated per-workspace clipboard history ring with `Ctrl+Shift+V` retrieval.
