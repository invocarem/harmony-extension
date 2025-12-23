/**
 * HTML Entity Decoder
 * Utility for decoding HTML entities in strings
 */

export class HtmlEntityDecoder {
  private static readonly ENTITIES: Record<string, string> = {
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
  };

  /**
   * Decode HTML entities in a string
   */
  static decode(text: string): string {
    let decoded = text;
    
    // Decode named entities
    for (const [entity, char] of Object.entries(this.ENTITIES)) {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }
    
    // Decode numeric entities like &#34; (decimal)
    decoded = decoded.replace(/&#(\d+);/g, (match, code) => {
      return String.fromCharCode(parseInt(code, 10));
    });
    
    // Decode hex entities like &#x22; (hexadecimal)
    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
      return String.fromCharCode(parseInt(code, 16));
    });
    
    return decoded;
  }
}

