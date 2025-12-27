/**
 * Utility for filtering Harmony protocol tokens from text
 * Used when harmonyMode is false to clean templates and responses
 */

/**
 * Filter out harmony tokens from text
 * Removes all Harmony protocol tokens (<|...|>) and related keywords
 * 
 * @param text - The text to filter
 * @returns The filtered text with Harmony tokens removed
 */
export function filterHarmonyTokens(text: string): string {
  // First remove all harmony tokens: <|...|>
  let filtered = text.replace(/<\|[^|]+\|>/g, '');
  
  // Remove channel type keywords that appear between tokens
  // These keywords appear concatenated (e.g., "userfinal", "assistantfinal") 
  // when they're part of the Harmony protocol structure
  const harmonyKeywords = ['user', 'assistant', 'final', 'analysis', 'commentary', 'start', 'end', 'channel', 'message'];
  const keywordPattern = harmonyKeywords.join('|');
  
  // Remove sequences of harmony keywords that are concatenated together
  // Iterate to handle all sequences like "userfinal", "assistantfinal", etc.
  // We match a harmony keyword followed immediately (no space/letter) by another harmony keyword
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    const before = filtered;
    // Match harmony keyword immediately followed by another harmony keyword (concatenated)
    for (const keyword of harmonyKeywords) {
      for (const otherKeyword of harmonyKeywords) {
        if (keyword !== otherKeyword) {
          // Remove concatenated pairs like "userfinal", "finalassistant", etc.
          filtered = filtered.replace(new RegExp(`${keyword}${otherKeyword}`, 'gi'), '');
        }
      }
      // Also handle sequences of same keyword (unlikely but possible)
      filtered = filtered.replace(new RegExp(`${keyword}${keyword}`, 'gi'), '');
    }
    // Remove single harmony keywords at the very start of string
    filtered = filtered.replace(new RegExp(`^(${keywordPattern})(?![a-zA-Z])`, 'gi'), '');
    // Remove pipe-prefixed harmony keywords (e.g., |assistant)
    filtered = filtered.replace(new RegExp(`\\|(${keywordPattern})(?![a-zA-Z])`, 'gi'), '');
    // Remove pipe-suffixed harmony keywords (e.g., assistant|)
    filtered = filtered.replace(new RegExp(`(${keywordPattern})\\|`, 'gi'), '');
    changed = (before !== filtered);
    iterations++;
  }
  
  // Clean up extra whitespace and leading pipes
  filtered = filtered.replace(/\s+/g, ' ').trim();
  // Remove leading pipe if it exists (from patterns like |assistant being partially cleaned)
  filtered = filtered.replace(/^\|+/, '').trim();
  return filtered;
}

