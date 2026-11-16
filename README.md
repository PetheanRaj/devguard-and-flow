# DevGuard Flow Suite

<p align="center">
  <img src="https://raw.githubusercontent.com/petheanraj/devguard-and-flow/main/icon.png" width="128" height="128" alt="DevGuard Flow Logo" />
</p>

<p align="center">
  <b>Zero-bloat, modular developer security guard & workflow enhancement suite for VS Code.</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=PetheanRaj.devguard-flow-suite"><img src="https://img.shields.io/visual-studio-marketplace/v/PetheanRaj.devguard-flow-suite?style=flat-square&color=blue" alt="Marketplace Version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=PetheanRaj.devguard-flow-suite"><img src="https://img.shields.io/visual-studio-marketplace/i/PetheanRaj.devguard-flow-suite?style=flat-square&color=success" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=PetheanRaj.devguard-flow-suite"><img src="https://img.shields.io/visual-studio-marketplace/r/PetheanRaj.devguard-flow-suite?style=flat-square&color=yellow" alt="Rating"></a>
  <img src="https://img.shields.io/badge/bundle-51KB-brightgreen?style=flat-square" alt="Bundle Size">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

---

## ⚡ What is DevGuard Flow?

DevGuard Flow Suite is a developer-first VS Code extension that shields credentials, eliminates forgotten debug logs, translates complex regex & cron schedules into plain English, and provides an isolated clipboard ring with Activity Bar integration—all bundled into an ultra-fast **51 KB** footprint.

---

## 🛡️ Key Features

### 1. Smart `.env` & Secret Guard
- **Demo Mode Masking:** Click the `$(eye) Demo Mode` status bar item to instantly mask all `.env` secrets on screen (`••••••••••••••••`) during screen-sharing or pair programming, without modifying the underlying files on disk.
- **Hardcoded Secret Scanner:** Real-time Shannon entropy and regex detection flags exposed AWS keys, Stripe tokens, GitHub PATs, JWTs, and private keys.
- **`.env` vs `.env.example` Auto-Sync:** Saves you from out-of-sync configuration. Offers a 1-click QuickFix to sync missing keys to `.env.example` without copying secret values.
- **Multi-Environment Diff View (`DevGuard: Compare Environment Files`):** Compares `.env.local` vs `.env.production` side-by-side to highlight missing variables.
- **Pre-Commit Hook Guard (`DevGuard: Install Pre-Commit Secret Guard Hook`):** Protects your Git repository by blocking commits containing unencrypted `.env` files or exposed credentials.

### 2. Context-Aware Console Log Cleaner
- **Branch-Aware Debug Detection:** Diffs your active branch against `main` (or configured base branch) to pinpoint newly introduced `console.log`, `print()`, `dbg!`, or `fmt.Println` statements.
- **Cleanliness Status Bar Indicator:** Shows real-time branch cleanliness (e.g. `$(trash) 3 debug logs`). Click it to open the cleanup menu.
- **Delete OR Comment-Out:** Choose between deleting debug statements or commenting them out (`// ...`) so they can be re-enabled later during testing.
- **Custom Logger Signatures:** Add support for enterprise loggers like `logger.debug`, `pino.debug`, or `console.tron` via settings.

### 3. Regex & Cron Translator Lens
- **Plain-English Cron Translator:** Automatically translates 5-part and 6-part cron expressions into human language (e.g., `0 15 10 ? * MON-FRI` → *"At 10:15 AM, Monday through Friday"*).
- **Upcoming Executions Calculator:** Hover over any cron schedule to view the **next 5 upcoming run times** in your local timezone!
- **Interactive In-Editor Regex Tester:** Test regular expressions in real-time right inside VS Code with live match counts and group previews.
- **CodeLens Overviews:** Inlines human-readable summaries directly above regex literals and cron strings.

### 4. Scoped Clipboard History Ring
- **Activity Bar Panel:** View and manage your clipboard history directly from the VS Code Side Bar.
- **⭐ Pin Snippets:** Pin your favorite frequently used snippets to keep them permanently at the top of your ring.
- **Workspace-Scoped & Isolated:** Keeps your last 20 clips isolated per project in workspace storage.
- **Smart Indentation on Paste:** Automatically adjusts multi-line snippet indentation to match your active cursor position.

---

## ⌨️ Shortcuts & Commands

| Command | Keybinding | Action |
| :--- | :--- | :--- |
| `DevGuard: Show Clipboard History Ring` | `Ctrl+Shift+V` / `Cmd+Shift+V` | Open searchable clipboard ring |
| `DevGuard: Toggle Demo Mode` | Status Bar | Mask / unmask `.env` values |
| `DevGuard: Clean Branch Debug Logs` | Command Palette | Review and delete/comment debug statements |
| `DevGuard: Test Regex Pattern Interactively` | CodeLens / Palette | Test regex against live input string |
| `DevGuard: Compare Environment Files` | Command Palette | Compare two `.env` files side-by-side |
| `DevGuard: Install Pre-Commit Hook` | Command Palette | Install Git security hook |

---

## ⚙️ Configuration

| Setting | Default | Description |
| :--- | :--- | :--- |
| `devguard.enableCodeLens` | `true` | Show plain-English CodeLens above regexes and cron schedules. |
| `devguard.baseBranch` | `"main"` | Base Git branch used to identify newly added debug console statements. |
| `devguard.customLogPatterns` | `["logger.debug", ...]` | Custom logger signatures tracked for branch cleanup. |
| `devguard.clipboardRingSize` | `20` | Maximum items stored in the clipboard ring per workspace. |
| `devguard.secretScanner.entropyThreshold` | `4.2` | Shannon entropy threshold for flagging random secret tokens. |
| `devguard.demoMode.maskPattern` | `"••••••••••••••••"` | Visual mask applied in Demo Mode. |

---

## 📄 License

MIT © Pethean Raj
