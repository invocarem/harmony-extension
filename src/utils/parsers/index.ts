/**
 * XML Attribute Parsers
 * 
 * This module provides a strategy-based approach to parsing XML tool call attributes.
 * Each parser implements a specific parsing strategy and can be used independently.
 * 
 * Parsers are tried in order until one succeeds:
 * 1. SimpleQuoteParser - Fast quote-based parsing for well-formed XML
 * 2. BraceMatchingParser - Robust brace matching for complex JSON
 * 3. LenientParser - Fallback for malformed/incomplete attributes
 */

export { AttributeParser, ParseResult } from "./AttributeParser";
export { ParserUtils } from "./ParserUtils";
export { SimpleQuoteParser } from "./SimpleQuoteParser";
export { BraceMatchingParser } from "./BraceMatchingParser";
export { LenientParser } from "./LenientParser";
