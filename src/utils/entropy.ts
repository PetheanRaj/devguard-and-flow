/**
 * Computes the Shannon entropy (in bits per character) of a string.
 * High entropy (> 4.2) typically indicates cryptographic keys, base64 tokens, or random secrets.
 *
 * @param str The string to evaluate
 * @returns Entropy value in bits [0.0 - 8.0]
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) {
    return 0;
  }

  const charFrequencies = new Map<string, number>();
  for (const char of str) {
    charFrequencies.set(char, (charFrequencies.get(char) || 0) + 1);
  }

  let entropy = 0;
  const len = str.length;

  for (const count of charFrequencies.values()) {
    const probability = count / len;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

/**
 * Checks whether a candidate string looks like a high-entropy secret.
 *
 * @param str The candidate secret value
 * @param minLength Minimum length of the secret (default: 16)
 * @param threshold Entropy threshold (default: 4.2)
 */
export function isHighEntropySecret(
  str: string,
  minLength: number = 16,
  threshold: number = 4.2
): boolean {
  if (!str || str.length < minLength) {
    return false;
  }

  // Skip common false positives: URLs, paths, long words, pure numbers, pure repeated chars
  if (
    str.startsWith('http://') ||
    str.startsWith('https://') ||
    str.includes('/') && !str.includes('+') || // path-like
    /^[0-9]+$/.test(str) || // all numbers
    /^[a-fA-F0-9]+$/.test(str) && str.length < 32 // short hex
  ) {
    return false;
  }

  const entropy = calculateShannonEntropy(str);
  return entropy >= threshold;
}
