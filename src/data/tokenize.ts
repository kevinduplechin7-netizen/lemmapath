export function countTokensDefault(text: string): number {
  const cleaned = text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if (!cleaned) return 0;

  const parts = cleaned
    .split(/[\s.,;:!?(){}\[\]"'“”‘’—–\-_/\\|]+/g)
    .filter(Boolean);

  return parts.length;
}

export function countTokensCJKApprox(text: string): number {
  const cleaned = text
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .trim();
  return cleaned.length;
}

export function countTokens(text: string, cjkMode: boolean): number {
  return cjkMode ? countTokensCJKApprox(text) : countTokensDefault(text);
}
