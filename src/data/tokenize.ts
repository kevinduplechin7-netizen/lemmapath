export function countTokensDefault(text: string): number {
  const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!cleaned) return 0;

  const parts = cleaned
    .split(/[\s.,;:!?(){}\[\]"'“”‘’—–\-_/\\|]+/g)
    .filter(Boolean);

  return parts.length;
}

export function countTokensCJKApprox(text: string): number {
  const cleaned = text.replace(/[\s\p{P}\p{S}]/gu, "").trim();
  return cleaned.length;
}

export function countTokens(text: string, cjkMode: boolean): number {
  return cjkMode ? countTokensCJKApprox(text) : countTokensDefault(text);
}

/**
 * Tokenize text into a de-duplicated list of "word-ish" tokens.
 *
 * - For CJK mode, we approximate by counting individual characters as tokens.
 * - For non-CJK, we split on whitespace and common punctuation.
 */
export function tokenizeText(text: string, cjkMode: boolean): string[] {
  const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!cleaned) return [];

  if (cjkMode) {
    return Array.from(
      new Set(
        cleaned
          .replace(/[\s\p{P}\p{S}]/gu, "")
          .split("")
          .filter(Boolean)
      )
    );
  }

  const parts = cleaned
    .split(/[\s.,;:!?(){}\[\]"'“”‘’—–\-_/\\|]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  return Array.from(new Set(parts));
}
