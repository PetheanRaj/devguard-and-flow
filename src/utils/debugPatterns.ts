/**
 * Multi-Language Debug Statement Detection Engine.
 * Covers all major programming languages, runtimes, and debugging libraries.
 */

export interface LanguagePatternConfig {
  patterns: RegExp[];
  commentPrefix: string;
}

/**
 * Language-specific regexes and comment syntax.
 */
export const LANGUAGE_DEBUG_REGISTRY: Record<string, LanguagePatternConfig> = {
  // JavaScript / TypeScript / React
  javascript: {
    patterns: [
      /\bconsole\.(?:log|warn|debug|info|error|trace|table|dir|time|timeEnd|group|groupEnd|assert|count)\s*\(/,
      /\bdebugger\s*;?/,
    ],
    commentPrefix: '// ',
  },
  typescript: {
    patterns: [
      /\bconsole\.(?:log|warn|debug|info|error|trace|table|dir|time|timeEnd|group|groupEnd|assert|count)\s*\(/,
      /\bdebugger\s*;?/,
    ],
    commentPrefix: '// ',
  },
  javascriptreact: {
    patterns: [
      /\bconsole\.(?:log|warn|debug|info|error|trace|table|dir)\s*\(/,
      /\bdebugger\s*;?/,
    ],
    commentPrefix: '// ',
  },
  typescriptreact: {
    patterns: [
      /\bconsole\.(?:log|warn|debug|info|error|trace|table|dir)\s*\(/,
      /\bdebugger\s*;?/,
    ],
    commentPrefix: '// ',
  },

  // Python
  python: {
    patterns: [
      /\bprint\s*\(/,
      /\blogging\.(?:debug|info|warning|error|critical)\s*\(/,
      /\bbreakpoint\s*\(\s*\)/,
      /(?:import\s+(?:p|i)db;\s*)?(?:p|i)db\.set_trace\s*\(\s*\)/,
      /\bic\s*\(/, // IceCream
    ],
    commentPrefix: '# ',
  },

  // Java & Kotlin
  java: {
    patterns: [
      /\bSystem\.(?:out|err)\.(?:println|print|printf)\s*\(/,
      /\bLog\.(?:v|d|i|w|e)\s*\(/, // Android Log
    ],
    commentPrefix: '// ',
  },
  kotlin: {
    patterns: [
      /\bprintln\s*\(/,
      /\bprint\s*\(/,
      /\bLog\.(?:v|d|i|w|e)\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // C & C++
  c: {
    patterns: [
      /\bprintf\s*\(/,
      /\bfprintf\s*\(\s*stderr\s*,/,
      /\bputs\s*\(/,
    ],
    commentPrefix: '// ',
  },
  cpp: {
    patterns: [
      /\bstd::(?:cout|cerr|clog)\s*<</,
      /\bprintf\s*\(/,
      /\bfprintf\s*\(\s*stderr\s*,/,
      /\bputs\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // C# (.NET)
  csharp: {
    patterns: [
      /\bConsole\.(?:WriteLine|Write)\s*\(/,
      /\bDebug\.(?:WriteLine|Write|Print|Assert)\s*\(/,
      /\bTrace\.(?:WriteLine|Write)\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Go (Golang)
  go: {
    patterns: [
      /\bfmt\.(?:Println|Printf|Print)\s*\(/,
      /\blog\.(?:Println|Printf|Print|Fatal|Panic)\s*\(/,
      /\bprintln\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Rust
  rust: {
    patterns: [
      /\bdbg!\s*\(/,
      /\bprintln!\s*\(/,
      /\beprintln!\s*\(/,
      /\bprint!\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // PHP
  php: {
    patterns: [
      /\bvar_dump\s*\(/,
      /\bdd\s*\(/,
      /\bdump\s*\(/,
      /\bprint_r\s*\(/,
      /\berror_log\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Ruby
  ruby: {
    patterns: [
      /\bputs\b/,
      /\bp\s+[^\n]+/,
      /\bpp\s+[^\n]+/,
      /\bbinding\.(?:pry|irb)\b/,
      /\bbyebug\b/,
    ],
    commentPrefix: '# ',
  },

  // Swift & Objective-C
  swift: {
    patterns: [
      /\bprint\s*\(/,
      /\bdebugPrint\s*\(/,
      /\bdump\s*\(/,
      /\bNSLog\s*\(/,
    ],
    commentPrefix: '// ',
  },
  objective_c: {
    patterns: [
      /\bNSLog\s*\(/,
      /\bprintf\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Dart & Flutter
  dart: {
    patterns: [
      /\bprint\s*\(/,
      /\bdebugPrint\s*\(/,
      /\blog\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Shell / Bash / PowerShell
  shellscript: {
    patterns: [
      /\becho\s+/,
      /\bprintf\s+/,
    ],
    commentPrefix: '# ',
  },
  powershell: {
    patterns: [
      /\bWrite-Host\b/,
      /\bWrite-Output\b/,
      /\bWrite-Debug\b/,
    ],
    commentPrefix: '# ',
  },

  // Elixir
  elixir: {
    patterns: [
      /\bIO\.inspect\s*\(/,
      /\bIO\.puts\s*\(/,
      /\bdbg\s*\(/,
    ],
    commentPrefix: '# ',
  },

  // R
  r: {
    patterns: [
      /\bprint\s*\(/,
      /\bcat\s*\(/,
      /\bmessage\s*\(/,
    ],
    commentPrefix: '# ',
  },

  // Lua
  lua: {
    patterns: [
      /\bprint\s*\(/,
    ],
    commentPrefix: '-- ',
  },

  // Scala
  scala: {
    patterns: [
      /\bprintln\s*\(/,
      /\bprint\s*\(/,
    ],
    commentPrefix: '// ',
  },

  // Perl
  perl: {
    patterns: [
      /\bprint\s+/,
      /\bsay\s+/,
      /\bDumper\s*\(/,
    ],
    commentPrefix: '# ',
  },
};

/**
 * Universal fallback pattern matching common log styles in any language.
 */
export const UNIVERSAL_FALLBACK_PATTERNS: RegExp[] = [
  /\bconsole\.(?:log|warn|debug|info|error|trace|table|dir)\s*\(/,
  /\bSystem\.(?:out|err)\.(?:println|print|printf)\s*\(/,
  /\bConsole\.(?:WriteLine|Write)\s*\(/,
  /\bfmt\.(?:Println|Printf|Print)\s*\(/,
  /\bstd::(?:cout|cerr)\s*<</,
  /\bprint\s*\(/,
  /\bprintln!\s*\(/,
  /\bdbg!\s*\(/,
  /\bvar_dump\s*\(/,
  /\bdd\s*\(/,
  /\bdump\s*\(/,
  /\bdebugger\s*;?/,
];

/**
 * Determines whether a line contains a debug statement for the given language.
 */
export function matchDebugStatement(
  lineText: string,
  languageId: string,
  customPatterns: string[] = []
): { isMatch: boolean; functionName: string; startIndex: number } | null {
  // Skip commented lines
  if (/^\s*(\/\/|#|\/\*|\*|--|;)/.test(lineText)) {
    return null;
  }

  // 1. Check custom patterns from settings first
  if (customPatterns.length > 0) {
    for (const cp of customPatterns) {
      const esc = cp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const customRegex = new RegExp(`\\b${esc}(?:\\s*\\(|\\b)`);
      const match = lineText.match(customRegex);
      if (match) {
        return {
          isMatch: true,
          functionName: cp,
          startIndex: match.index || 0,
        };
      }
    }
  }

  // 2. Check language-specific patterns
  const config = LANGUAGE_DEBUG_REGISTRY[languageId.toLowerCase()];
  const patternsToTest = config ? config.patterns : UNIVERSAL_FALLBACK_PATTERNS;

  for (const pattern of patternsToTest) {
    const match = lineText.match(pattern);
    if (match) {
      const matchedStr = match[0].replace(/\s*\($/, '').replace(/\s*<<$/, '').trim();
      return {
        isMatch: true,
        functionName: matchedStr,
        startIndex: match.index || 0,
      };
    }
  }

  return null;
}

/**
 * Gets appropriate single-line comment prefix for a language.
 */
export function getCommentPrefix(languageId: string): string {
  const config = LANGUAGE_DEBUG_REGISTRY[languageId.toLowerCase()];
  return config ? config.commentPrefix : '// ';
}
