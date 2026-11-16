import { RegexTokenExplanation } from '../types';

export interface RegexMatchResult {
  pattern: string;
  flags: string;
  fullMatch: string;
  index: number;
  length: number;
}

export interface CronMatchResult {
  expression: string;
  fullMatch: string;
  index: number;
  length: number;
}

/**
 * Common regex literal pattern matcher:
 * Matches JS/TS literals `/pattern/flags` (excluding comments `//...`),
 * `new RegExp('pattern', 'flags')`, and Python `re.compile(r'pattern')`.
 */
export function findRegexLiterals(lineText: string): RegexMatchResult[] {
  const results: RegexMatchResult[] = [];

  // 1. JS/TS regex literal: /(?:[^\n\\/]|\\.)+\/[gimsuyv]*
  // Must avoid matching comments '//' or division operators
  const literalRegex = /(^|[^/a-zA-Z0-9_$\\])\/((?:\\.|[^\n\\/])+)\/([gimsuyv]*)(?=[^/a-zA-Z0-9_]|$)/g;
  let match: RegExpExecArray | null;

  while ((match = literalRegex.exec(lineText)) !== null) {
    const prefix = match[1];
    const pattern = match[2];
    const flags = match[3];

    // Filter out obvious empty regex or division like ' / '
    if (pattern.trim().length === 0 || pattern.startsWith('*') || pattern.startsWith('/')) {
      continue;
    }

    const startIndex = match.index + prefix.length;
    const fullMatch = `/${pattern}/${flags}`;

    results.push({
      pattern,
      flags,
      fullMatch,
      index: startIndex,
      length: fullMatch.length,
    });
  }

  // 2. new RegExp("...", "...")
  const newRegExpRegex = /new\s+RegExp\(\s*(['"`])((?:\\.|(?!\1).)+)\1(?:\s*,\s*(['"`])([gimsuyv]*)\3)?\s*\)/g;
  while ((match = newRegExpRegex.exec(lineText)) !== null) {
    const pattern = match[2];
    const flags = match[4] || '';
    results.push({
      pattern,
      flags,
      fullMatch: match[0],
      index: match.index,
      length: match[0].length,
    });
  }

  // 3. Python re.compile(r"...")
  const pyReRegex = /re\.compile\(\s*r?(['"])(.+?)\1(?:\s*,\s*re\.([A-Z|]+))?\s*\)/g;
  while ((match = pyReRegex.exec(lineText)) !== null) {
    const pattern = match[2];
    const flags = match[3] || '';
    results.push({
      pattern,
      flags,
      fullMatch: match[0],
      index: match.index,
      length: match[0].length,
    });
  }

  return results;
}

/**
 * Detects 5-part and 6-part cron expressions inside string quotes or YAML syntax.
 */
export function findCronExpressions(lineText: string): CronMatchResult[] {
  const results: CronMatchResult[] = [];

  // Match 5 or 6 token cron patterns inside quotes or YAML keys
  // e.g. "0 15 10 ? * MON-FRI", "*/5 * * * *", '0 0 * * *'
  const cronRegex = /(['"])([0-9A-Za-z*?/,#-]+(?:\s+[0-9A-Za-z*?/,#-]+){4,5})\1/g;
  let match: RegExpExecArray | null;

  while ((match = cronRegex.exec(lineText)) !== null) {
    const expression = match[2].trim();
    const parts = expression.split(/\s+/);

    // Validate that parts look like cron parts (contain digits, *, ?, / or common month/day names)
    if (parts.length >= 5 && parts.length <= 6) {
      const isValidCronFormat = parts.every((p) =>
        /^[0-9*?/,#-]+$/i.test(p) ||
        /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i.test(p) ||
        /^(MON|TUE|WED|THU|FRI|SAT|SUN)$/i.test(p)
      );

      if (isValidCronFormat) {
        results.push({
          expression,
          fullMatch: match[0],
          index: match.index + match[1].length,
          length: expression.length,
        });
      }
    }
  }

  return results;
}

/**
 * Translates regex tokens into plain English explanations.
 */
export function explainRegexTokens(pattern: string, flags: string): RegexTokenExplanation[] {
  const explanations: RegexTokenExplanation[] = [];

  // Explain flags
  if (flags) {
    for (const flag of flags) {
      let desc = '';
      switch (flag) {
        case 'g':
          desc = 'Global search (match all occurrences, not stopping at the first)';
          break;
        case 'i':
          desc = 'Case-insensitive matching (ignores uppercase/lowercase differences)';
          break;
        case 'm':
          desc = 'Multiline mode (^ and $ match start and end of each line)';
          break;
        case 's':
          desc = 'DotAll mode (the . token matches newline characters as well)';
          break;
        case 'u':
          desc = 'Unicode mode (treats pattern as a sequence of Unicode code points)';
          break;
        case 'y':
          desc = 'Sticky mode (matches only from the index indicated by lastIndex)';
          break;
        case 'v':
          desc = 'Extended Unicode Sets mode (set operations & string properties)';
          break;
        default:
          desc = `Flag '${flag}'`;
      }
      explanations.push({
        raw: flag,
        category: 'flag',
        explanation: desc,
      });
    }
  }

  // Tokenize key pattern segments
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];

    // Escaped sequences
    if (char === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      const seq = '\\' + next;
      let exp = '';

      switch (next) {
        case 'd':
          exp = 'Matches any digit (equivalent to [0-9])';
          break;
        case 'D':
          exp = 'Matches any non-digit character';
          break;
        case 'w':
          exp = 'Matches any word character (letters, digits, underscore)';
          break;
        case 'W':
          exp = 'Matches any non-word character';
          break;
        case 's':
          exp = 'Matches any whitespace character (space, tab, newline)';
          break;
        case 'S':
          exp = 'Matches any non-whitespace character';
          break;
        case 'b':
          exp = 'Matches a word boundary position';
          break;
        case 'B':
          exp = 'Matches a non-word boundary position';
          break;
        default:
          exp = `Escaped literal '${next}'`;
      }

      explanations.push({ raw: seq, category: 'escape', explanation: exp });
      i += 2;
      continue;
    }

    // Anchors
    if (char === '^') {
      explanations.push({
        raw: '^',
        category: 'anchor',
        explanation: 'Asserts position at start of string (or start of line in multiline mode)',
      });
      i++;
      continue;
    }

    if (char === '$') {
      explanations.push({
        raw: '$',
        category: 'anchor',
        explanation: 'Asserts position at end of string (or end of line in multiline mode)',
      });
      i++;
      continue;
    }

    // Character classes [...]
    if (char === '[') {
      const closeIdx = pattern.indexOf(']', i + 1);
      if (closeIdx !== -1) {
        const classContent = pattern.substring(i, closeIdx + 1);
        const isNegated = classContent.startsWith('[^');
        let detail = '';

        if (classContent === '[a-z0-9_-]') {
          detail = 'Lowercase letters, digits, underscore, and hyphen';
        } else if (classContent === '[a-zA-Z0-9]') {
          detail = 'Any alphanumeric character (letters and digits)';
        } else if (classContent === '[0-9]') {
          detail = 'Any digit 0 through 9';
        } else {
          detail = classContent.slice(isNegated ? 2 : 1, -1);
        }

        explanations.push({
          raw: classContent,
          category: 'charset',
          explanation: isNegated
            ? `Match any character NOT in set: ${detail}`
            : `Match any character in set: ${detail}`,
        });
        i = closeIdx + 1;
        continue;
      }
    }

    // Quantifiers {...}
    if (char === '{') {
      const closeIdx = pattern.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const qContent = pattern.substring(i, closeIdx + 1);
        const inner = qContent.slice(1, -1);
        let qDesc = '';

        if (inner.includes(',')) {
          const [min, max] = inner.split(',');
          if (max === '') {
            qDesc = `Matches at least ${min} times`;
          } else {
            qDesc = `Matches between ${min} and ${max} times`;
          }
        } else {
          qDesc = `Matches exactly ${inner} times`;
        }

        explanations.push({
          raw: qContent,
          category: 'quantifier',
          explanation: qDesc,
        });
        i = closeIdx + 1;
        continue;
      }
    }

    // Other quantifiers
    if (char === '+') {
      explanations.push({
        raw: '+',
        category: 'quantifier',
        explanation: 'Matches 1 or more times (greedy)',
      });
      i++;
      continue;
    }
    if (char === '*') {
      explanations.push({
        raw: '*',
        category: 'quantifier',
        explanation: 'Matches 0 or more times (greedy)',
      });
      i++;
      continue;
    }
    if (char === '?') {
      explanations.push({
        raw: '?',
        category: 'quantifier',
        explanation: 'Matches 0 or 1 time (optional)',
      });
      i++;
      continue;
    }
    if (char === '.') {
      explanations.push({
        raw: '.',
        category: 'charset',
        explanation: 'Matches any single character (except line terminators unless s flag is set)',
      });
      i++;
      continue;
    }

    // Groups
    if (char === '(') {
      if (pattern.startsWith('(?:', i)) {
        explanations.push({ raw: '(?:...)', category: 'group', explanation: 'Non-capturing group' });
        i += 3;
        continue;
      } else if (pattern.startsWith('(?=', i)) {
        explanations.push({ raw: '(?=...)', category: 'group', explanation: 'Positive lookahead assertion' });
        i += 3;
        continue;
      } else if (pattern.startsWith('(?!', i)) {
        explanations.push({ raw: '(?!...)', category: 'group', explanation: 'Negative lookahead assertion' });
        i += 3;
        continue;
      } else if (pattern.startsWith('(?<=', i)) {
        explanations.push({ raw: '(?<=...)', category: 'group', explanation: 'Positive lookbehind assertion' });
        i += 4;
        continue;
      } else if (pattern.startsWith('(?<!', i)) {
        explanations.push({ raw: '(?<!...)', category: 'group', explanation: 'Negative lookbehind assertion' });
        i += 4;
        continue;
      } else {
        explanations.push({ raw: '(...)', category: 'group', explanation: 'Capturing group' });
        i++;
        continue;
      }
    }

    i++;
  }

  return explanations;
}

/**
 * Builds a markdown summary table for regex explanation.
 */
export function buildRegexMarkdown(pattern: string, flags: string): string {
  const tokens = explainRegexTokens(pattern, flags);

  let md = `### 🔍 DevGuard Regex Breakdown\n\n`;
  md += `**Pattern:** \`/${pattern}/${flags}\`\n\n`;

  if (tokens.length === 0) {
    md += `*Standard literal pattern.*\n`;
    return md;
  }

  md += `| Token | Type | Plain-English Explanation |\n`;
  md += `| :--- | :--- | :--- |\n`;

  for (const t of tokens) {
    const sanitizedToken = t.raw.replace(/\|/g, '\\|');
    md += `| \`${sanitizedToken}\` | **${t.category}** | ${t.explanation} |\n`;
  }

  return md;
}
