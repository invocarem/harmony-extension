/**
 * Utility to clean and format verbose model responses
 */

/**
 * Pretty-print JSON string with proper indentation
 */
function formatJSON(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // If parsing fails, return original string
    return jsonString;
  }
}

/**
 * Find the longest valid JSON structure at the end of a string
 * Returns the JSON string and its start index, or null if not found
 * Optimized: works backwards from the end to find the start bracket
 */
function findJSONAtEnd(text: string): { json: string; startIndex: number } | null {
  // Trim whitespace from end first
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return null;
  
  // The last char should be ] or } for valid JSON
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== ']' && lastChar !== '}') {
    return null;
  }
  
  // Limit search to last 10000 chars for performance
  const maxSearchLength = Math.min(10000, trimmed.length);
  const searchStart = Math.max(0, trimmed.length - maxSearchLength);
  const searchText = trimmed.substring(searchStart);
  
  // Find the end position (skip trailing whitespace)
  let endPos = searchText.length;
  while (endPos > 0 && /\s/.test(searchText[endPos - 1])) {
    endPos--;
  }
  
  if (endPos === 0) return null;
  
  // Find the last [ or { before the end
  // Work backwards to find potential start positions
  const targetCloseBracket = lastChar;
  const targetOpenBracket = lastChar === ']' ? '[' : '{';
  
  // Try positions working backwards from the end
  // Start from near the end (most likely position) and work backwards
  for (let tryStart = endPos - 1; tryStart >= 0 && (endPos - tryStart) <= 5000; tryStart--) {
    // Skip whitespace
    while (tryStart >= 0 && /\s/.test(searchText[tryStart])) {
      tryStart--;
    }
    if (tryStart < 0) break;
    
    // Only try if it starts with the matching bracket type
    if (searchText[tryStart] !== targetOpenBracket) {
      continue;
    }
    
    // Try parsing from this position to the end
    const potentialJSON = searchText.substring(tryStart, endPos).trim();
    if (potentialJSON.length < 2) continue; // Too short to be valid JSON
    
    try {
      JSON.parse(potentialJSON);
      // Successfully parsed! Return this JSON
      return {
        json: potentialJSON,
        startIndex: searchStart + tryStart
      };
    } catch {
      // Not valid JSON, continue searching backwards
    }
  }
  
  return null;
}

/**
 * Remove instructional blocks that start with ⚠️ NOTE:
 * These are typically instructions meant for the LLM but being echoed back in responses.
 * Different models may handle this differently, so we filter them out.
 */
function removeInstructionalNotes(content: string): string {
  // Remove blocks starting with "⚠️ NOTE:" - these are instructions being echoed back
  // Match from "⚠️ NOTE:" to the next empty line or end of content
  const instructionBlockPattern = /⚠️\s*NOTE:.*?(?=\n\n|\n[A-Z]|$)/gs;
  return content.replace(instructionBlockPattern, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Clean verbose responses by extracting the main content (e.g., JSON blocks)
 * Removes excessive reasoning/thinking before the actual answer
 */
export function cleanVerboseResponse(content: string): string {
  if (!content) return content;
  
  // Remove instructional notes that some models echo back
  content = removeInstructionalNotes(content);
  
  // Try to extract JSON blocks if present (they're usually at the end)
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch && jsonBlockMatch.index !== undefined) {
    // If there's a JSON block, prefer it with minimal context
    const beforeJson = content.substring(0, jsonBlockMatch.index).trim();
    
    // Format the JSON inside the code block
    const jsonContent = jsonBlockMatch[1].trim();
    const formattedJSON = formatJSON(jsonContent);
    
    // Look for a brief restatement section (usually marked by headers or "Restating")
    // Try to find the last meaningful section before JSON (like "Restating the problem" or "Brief context")
    const restatementPatterns = [
      /(?:Restating the problem:|Brief context:|Restating|Brief summary:)[\s\S]{0,800}/i,
      /(?:First,|Then,)[\s\S]{0,500}/i,
    ];
    
    let bestMatch: { text: string; start: number } | null = null;
    for (const pattern of restatementPatterns) {
      const matches = [...beforeJson.matchAll(new RegExp(pattern.source, 'gi'))];
      if (matches.length > 0) {
        // Take the last match (closest to JSON)
        const match = matches[matches.length - 1];
        if (match.index !== undefined) {
          const matchText = match[0];
          // Extract up to 400 chars from this match point
          const extracted = beforeJson.substring(match.index, Math.min(match.index + matchText.length + 400, beforeJson.length));
          if (!bestMatch || match.index > bestMatch.start) {
            bestMatch = { text: extracted.trim(), start: match.index };
          }
        }
      }
    }
    
    if (bestMatch) {
      // Keep the restatement but limit its length
      const restatement = bestMatch.text.length > 400 
        ? '...' + bestMatch.text.substring(bestMatch.text.length - 400)
        : bestMatch.text;
      return restatement + '\n\n' + '```json\n' + formattedJSON + '\n```';
    }
    
    // If no clear restatement found, check if beforeJson is very long
    if (beforeJson.length > 500) {
      // Keep only the last 300 chars as context
      const briefContext = '...' + beforeJson.substring(beforeJson.length - 300);
      return briefContext + '\n\n' + '```json\n' + formattedJSON + '\n```';
    }
    
    // Short prefix is fine, keep it
    return beforeJson + '\n\n' + '```json\n' + formattedJSON + '\n```';
  }
  
  // Try to find JSON at the end of content using balanced bracket matching
  // This is more robust than regex for nested structures
  const jsonAtEnd = findJSONAtEnd(content);
  if (jsonAtEnd) {
    try {
      const formattedJSON = formatJSON(jsonAtEnd.json);
      const beforeJson = content.substring(0, jsonAtEnd.startIndex).trim();
      
      // Only process if JSON looks substantial (at least 20 chars to avoid formatting tiny fragments)
      if (jsonAtEnd.json.length >= 20) {
        if (beforeJson.length > 500) {
          // Look for a restatement in the last 800 chars
          const last800 = beforeJson.substring(Math.max(0, beforeJson.length - 800));
          const restatementMatch = last800.match(/(?:Restating|Brief)[\s\S]{0,400}/i);
          if (restatementMatch) {
            return restatementMatch[0].trim() + '\n\n' + '```json\n' + formattedJSON + '\n```';
          }
          // Keep only the last 300 chars before JSON
          return '...' + beforeJson.substring(beforeJson.length - 300) + '\n\n' + '```json\n' + formattedJSON + '\n```';
        }
        if (beforeJson.length > 0) {
          return beforeJson + '\n\n' + '```json\n' + formattedJSON + '\n```';
        } else {
          // JSON is the only content, just format it
          return '```json\n' + formattedJSON + '\n```';
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }
  
  // If content is extremely long with repetitive reasoning, truncate early parts
  if (content.length > 2000) {
    // Check if it looks like verbose reasoning at the start
    const first500 = content.substring(0, 500).toLowerCase();
    if (first500.includes('restat') || first500.includes('brief context') || first500.includes('we must') || first500.includes('we are given')) {
      // Likely verbose - try to find where actual content starts
      const contentStart = content.search(/(```json|```\s*\n\s*\[|```\s*\n\s*\{)/i);
      if (contentStart > 500 && contentStart < content.length * 0.7) {
        // Content starts significantly into the response
        const beforeContent = content.substring(0, contentStart).trim();
        const actualContent = content.substring(contentStart);
        
        // Try to find a restatement in the last part
        const lastPart = beforeContent.substring(Math.max(0, beforeContent.length - 600));
        const restatementMatch = lastPart.match(/(?:Restating|Brief|First,)[\s\S]{0,400}/i);
        if (restatementMatch) {
          return restatementMatch[0].trim() + '\n\n' + actualContent;
        }
        
        // Keep only a brief summary of the prefix
        const briefPrefix = beforeContent.length > 300
          ? '...' + beforeContent.substring(beforeContent.length - 300) + '\n\n'
          : beforeContent + '\n\n';
        
        return briefPrefix + actualContent;
      }
    }
  }
  
  return content;
}

