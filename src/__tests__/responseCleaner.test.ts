import { cleanVerboseResponse } from '../utils/responseCleaner';

describe('responseCleaner', () => {
  describe('cleanVerboseResponse', () => {
    describe('JSON formatting', () => {
      it('should format JSON with multiple keys on same line', () => {
        // JSON with all keys on one line (minified)
        const minifiedJSON = '[{"lemma":"invenio","part_of_speech":"verb","conjugation":4,"present":"invenio","infinitive":"invenire","perfect":"inveni","supine":"inventus","future":"invenietur","forms":{"future_passive_3rd_sg":["invenietur"]},"translations":{"en":"discover, find","la":"invenio, invenire, inveni, inventus"}}]';
        const content = `Here is the analysis:\n${minifiedJSON}`;
        
        const result = cleanVerboseResponse(content);
        
        // Should wrap in code block
        expect(result).toContain('```json');
        expect(result).toContain('```');
        
        // Extract JSON from code block
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        const formattedJSON = jsonMatch![1].trim();
        
        // Should be properly formatted with indentation (not all on one line)
        expect(formattedJSON).not.toContain('"lemma":"invenio","part_of_speech"'); // Should have line breaks
        expect(formattedJSON).toContain('"lemma": "invenio"'); // Should have space after colon
        expect(formattedJSON).toContain('\n'); // Should have newlines
        
        // Should be valid JSON
        const parsed = JSON.parse(formattedJSON);
        expect(parsed).toBeInstanceOf(Array);
        expect(parsed[0].lemma).toBe('invenio');
      });

      it('should format JSON in code blocks', () => {
        const minifiedJSON = '{"name":"test","value":123,"nested":{"key":"value"}}';
        const content = `Restating the problem: You asked about formatting.\n\n\`\`\`json\n${minifiedJSON}\n\`\`\``;
        
        const result = cleanVerboseResponse(content);
        
        // Should still be in code block
        expect(result).toContain('```json');
        
        // Extract and verify formatting
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        const formattedJSON = jsonMatch![1].trim();
        
        // Should be formatted (not minified)
        expect(formattedJSON).toContain('\n'); // Should have newlines
        expect(formattedJSON).toContain('"name": "test"'); // Should have space after colon
        
        // Should be valid JSON
        const parsed = JSON.parse(formattedJSON);
        expect(parsed.name).toBe('test');
      });

      it('should format JSON array at end of content', () => {
        const minifiedJSON = '[{"lemma":"invenio","part_of_speech":"verb","conjugation":4}]';
        const content = `Analysis complete.\n${minifiedJSON}`;
        
        const result = cleanVerboseResponse(content);
        
        // Should wrap in code block
        expect(result).toContain('```json');
        
        // Extract and verify formatting
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        const formattedJSON = jsonMatch![1].trim();
        
        // Should be formatted with proper indentation
        expect(formattedJSON).toContain('\n');
        expect(formattedJSON).toContain('"lemma": "invenio"');
        expect(formattedJSON.split('\n').length).toBeGreaterThan(1); // Multiple lines
        
        // Should be valid JSON
        const parsed = JSON.parse(formattedJSON);
        expect(parsed).toBeInstanceOf(Array);
      });

      it('should format complex nested JSON structures', () => {
        const minifiedJSON = '{"lemma":"invenio","forms":{"future_passive_3rd_sg":["invenietur"],"present_active_1st_sg":["invenio"]},"translations":{"en":"discover, find","la":"invenio, invenire, inveni, inventus"}}';
        const content = minifiedJSON;
        
        const result = cleanVerboseResponse(content);
        
        // Should wrap in code block
        expect(result).toContain('```json');
        
        // Extract and verify formatting
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        const formattedJSON = jsonMatch![1].trim();
        
        // Should have proper indentation for nested structures
        expect(formattedJSON).toContain('"forms": {');
        expect(formattedJSON).toContain('"future_passive_3rd_sg": [');
        expect(formattedJSON.split('\n').length).toBeGreaterThan(5); // Should have multiple lines with proper nesting
        
        // Should be valid JSON
        const parsed = JSON.parse(formattedJSON);
        expect(parsed.forms.future_passive_3rd_sg).toEqual(['invenietur']);
      });

      it('should not format invalid JSON', () => {
        const invalidJSON = '{invalid json}';
        const content = `Some text\n${invalidJSON}`;
        
        const result = cleanVerboseResponse(content);
        
        // Should not try to format invalid JSON (may or may not wrap in code block)
        // But should not crash and should return the content
        expect(result).toBeTruthy();
      });

      it('should handle JSON with proper spacing in formatted output', () => {
        const minifiedJSON = '[{"key1":"value1","key2":"value2","key3":123}]';
        const content = minifiedJSON;
        
        const result = cleanVerboseResponse(content);
        
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        const formattedJSON = jsonMatch![1].trim();
        
        // Check that formatted JSON has proper spacing (key: value, not key:value)
        expect(formattedJSON).toContain('"key1": "value1"');
        expect(formattedJSON).toContain('"key2": "value2"');
        expect(formattedJSON).toContain('"key3": 123');
        
        // Each key should be on its own line (or at least properly indented)
        const lines = formattedJSON.split('\n');
        const keyValuePairs = lines.filter(line => /"key\d+":/.test(line));
        expect(keyValuePairs.length).toBeGreaterThan(0);
        
        // Verify valid JSON
        const parsed = JSON.parse(formattedJSON);
        expect(parsed[0].key1).toBe('value1');
      });
    });

    describe('Content cleaning', () => {
      it('should preserve non-JSON content', () => {
        const content = 'This is regular text without JSON.';
        const result = cleanVerboseResponse(content);
        expect(result).toBe(content);
      });

      it('should extract JSON from verbose responses', () => {
        const json = '{"result": "success", "data": {"key": "value", "number": 123}}';
        const content = `Restating the problem: You want to format this.\nBrief context: This is a test.\n${json}`;
        
        const result = cleanVerboseResponse(content);
        
        // Should extract JSON and format it
        expect(result).toContain('```json');
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        expect(jsonMatch).toBeTruthy();
        
        const parsed = JSON.parse(jsonMatch![1].trim());
        expect(parsed.result).toBe('success');
        expect(parsed.data.key).toBe('value');
      });
    });

    describe('Tool Results preservation', () => {
      it('should preserve tool results when content is truncated', () => {
        // Simulate a response with tool results that gets truncated
        const toolResults = '\n\n**Tool Results:**\n\n**exec_terminal**:\n4\n';
        const longContent = 'Looking at the user request and my role, I need to run calc.py to perform an addition operation. Let me first understand what calc.py does by reading it, then execute it with the requested parameters. '.repeat(30);
        const content = longContent + toolResults;
        
        const result = cleanVerboseResponse(content);
        
        // Tool results should be preserved
        expect(result).toContain('**Tool Results:**');
        expect(result).toContain('**exec_terminal**:');
        expect(result).toContain('4');
      });

      it('should preserve tool results when JSON is extracted', () => {
        const json = '{"result": "success"}';
        const toolResults = '\n\n**Tool Results:**\n\n**exec_terminal**:\nOutput: 4\n';
        const content = `Restating the problem: You want to format this.\nBrief context: This is a test.\n${json}${toolResults}`;
        
        const result = cleanVerboseResponse(content);
        
        // Tool results should be present (JSON formatting is secondary)
        expect(result).toContain('**Tool Results:**');
        expect(result).toContain('**exec_terminal**:');
        expect(result).toContain('Output: 4');
      });

      it('should preserve tool results when content is extremely long and truncated', () => {
        // This test demonstrates the actual bug: tool results are removed when content is truncated
        const toolResults = '\n\n**Tool Results:**\n\n**exec_terminal**:\n4\n';
        // Create very long content that triggers truncation (over 2000 chars with "restat" pattern)
        const longPrefix = 'Restating the problem: You want to run calc.py. '.repeat(60); // ~2400 chars
        const content = longPrefix + toolResults;
        
        const result = cleanVerboseResponse(content);
        
        // Tool results should ALWAYS be preserved, even when content is truncated
        expect(result).toContain('**Tool Results:**');
        expect(result).toContain('**exec_terminal**:');
        expect(result).toContain('4');
      });

      it('BUG REPRODUCTION: tool results removed when content triggers truncation logic', () => {
        // This reproduces the actual bug: when content is long and matches truncation patterns,
        // tool results at the end get removed because the truncation logic doesn't preserve them
        const toolResults = '\n\n**Tool Results:**\n\n**exec_terminal**:\n4\n';
        
        // Create content that triggers the truncation logic (length > 2000, contains "restat" pattern)
        // The truncation happens at line 211-216 in responseCleaner.ts
        const longVerboseContent = 'Restating the problem: You want to run calc.py. '.repeat(50); // ~2400 chars
        const content = longVerboseContent + toolResults;
        
        // Verify content has tool results before cleaning
        expect(content).toContain('**Tool Results:**');
        expect(content.length).toBeGreaterThan(2000); // Triggers truncation
        
        const result = cleanVerboseResponse(content);
        
        // BUG: Tool results are removed when truncation logic runs
        // The truncation at line 216 returns 'briefPrefix + actualContent' but doesn't include tool results
        console.log('Original content length:', content.length);
        console.log('Cleaned content length:', result.length);
        console.log('Original has tool results:', content.includes('**Tool Results:**'));
        console.log('Cleaned has tool results:', result.includes('**Tool Results:**'));
        
        // This assertion will FAIL, demonstrating the bug
        expect(result).toContain('**Tool Results:**');
        expect(result).toContain('**exec_terminal**:');
        expect(result).toContain('4');
      });

      it('should preserve tool results at the end of content', () => {
        const toolResults = '\n\n**Tool Results:**\n\n**exec_terminal**:\n4\n';
        const content = 'I executed the command successfully.' + toolResults;
        
        const result = cleanVerboseResponse(content);
        
        // Tool results should be preserved
        expect(result).toContain('**Tool Results:**');
        expect(result).toContain('**exec_terminal**:');
        expect(result).toContain('4');
        // Tool results should be at the end
        expect(result.indexOf('**Tool Results:**')).toBeGreaterThan(result.indexOf('successfully'));
      });
    });
  });
});

