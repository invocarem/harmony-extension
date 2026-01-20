// file: stepsMarkdownParser.test.ts
import { StepsMarkdownParser } from '../../utils/stepsMarkdownParser';

describe('StepsMarkdownParser', () => {
  describe('extractBoldContent', () => {
    test('should extract bold phrases from markdown text', () => {
      const text = 'This is **bold text** and **another bold** phrase.';
      const result = StepsMarkdownParser.extractBoldContent(text);
      
      expect(result.boldPhrases).toEqual(['bold text', 'another bold']);
      expect(result.positions).toEqual([8, 26]);
    });

    test('should handle multiple bold sections', () => {
      const text = '**First** then **Second** and **Third** items';
      const result = StepsMarkdownParser.extractBoldContent(text);
      
      expect(result.boldPhrases).toEqual(['First', 'Second', 'Third']);
      expect(result.positions).toEqual([0, 15, 30]);
    });

    test('should return empty arrays when no bold text', () => {
      const text = 'This text has no bold formatting.';
      const result = StepsMarkdownParser.extractBoldContent(text);
      
      expect(result.boldPhrases).toEqual([]);
      expect(result.positions).toEqual([]);
    });

    test('should handle bold with inner asterisks', () => {
      const text = '**text*with*asterisks**';
      const result = StepsMarkdownParser.extractBoldContent(text);
      
      expect(result.boldPhrases).toEqual(['text*with*asterisks']);
    });

    test('should trim whitespace from bold phrases', () => {
      const text = '**  spaced text  **';
      const result = StepsMarkdownParser.extractBoldContent(text);
      
      expect(result.boldPhrases).toEqual(['spaced text']);
    });
  });

  describe('stripBoldMarkdown', () => {
    test('should remove bold markdown from text', () => {
      const text = '**Bold** and **not bold** text';
      const result = StepsMarkdownParser.stripBoldMarkdown(text);
      
      expect(result).toBe('Bold and not bold text');
    });

    test('should handle text without bold', () => {
      const text = 'Plain text without formatting';
      const result = StepsMarkdownParser.stripBoldMarkdown(text);
      
      expect(result).toBe(text);
    });

    test('should handle empty string', () => {
      const result = StepsMarkdownParser.stripBoldMarkdown('');
      expect(result).toBe('');
    });

    test('should handle only bold characters', () => {
      const text = '****';
      const result = StepsMarkdownParser.stripBoldMarkdown(text);
      
      expect(result).toBe('');
    });
  });



  describe('extractPlanAndSteps', () => {
    test('should extract steps from numbered plan with colon', () => {
      const text = `4. Numbered Plan:
Step 1: Locate the relevant docx file in the uploads folder
Step 2: Read the file using binary reading mode and encode to Base64
Step 3: Call the Azure Document Intelligence API
Step 4: Save the extracted markdown`;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0]).toEqual({
        number: 1,
        content: 'Locate the relevant docx file in the uploads folder',
        isPlanStep: true
      });
      expect(result.steps[3].number).toBe(4);
    });

    test('should extract steps from plan without colon', () => {
      const text = `4. Numbered Plan
Step 1: Locate the docx file
Step 2: Convert it to Base64`;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.planSection).toBeDefined();
    });

    test('should extract steps without explicit plan section', () => {
      const text = `
      Here are the steps to follow:
      1. First step description
      2. Second step description
      3. Third step
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].isPlanStep).toBe(false);
    });

    test('should handle "Steps:" section', () => {
      const text = `
      Steps:
      1. Find the document
      2. Process the content
      3. Return result
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(3);
    });

    test('should handle "Execution:" section', () => {
      const text = `
      Execution:
      Step 1: Execute first action
      Step 2: Complete second task
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(2);
    });

    test('should handle mixed formatting with bold text', () => {
      const text = `
      4. Numbered Plan:
      Step 1: **Locate** the **file** in uploads
      Step 2: **Read** and **encode** the content
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].content).toBe('Locate the file in uploads');
      expect(result.steps[1].content).toBe('Read and encode the content');
    });

    test('should return empty steps when no plan or steps found', () => {
      const text = 'Just some random text without any steps.';
      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(false);
      expect(result.steps).toHaveLength(0);
    });

    test('should handle steps with period instead of colon', () => {
      const text = `
      Plan:
      Step 1. First action to take
      Step 2. Second step here
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].content).toBe('First action to take');
    });

    test('should handle numeric steps with dashes', () => {
      const text = `
      Steps
      1 - First item
      2 - Second item
      3 - Third item
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(3);
    });

    test('should filter out generic step descriptions', () => {
      const text = `
      Plan:
      Step 1: Execute step 1
      Step 2: This is a meaningful step with actual content
      Step 3: complete part 3
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.hasPlan).toBe(true);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].number).toBe(2);
      expect(result.steps[0].content).toBe('This is a meaningful step with actual content');
    });
  });

  describe('extractStepsFromSection (indirect testing)', () => {
    test('should extract steps with multi-line content', () => {
      const text = `
      Step 1: This is the first step
      with multiple lines of content
      that continue here.
      
      Step 2: Second step begins
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].content).toContain('This is the first step with multiple lines of content that continue here.');
    });

    test('should handle steps separated by blank lines', () => {
      const text = `
      Step 1: First step content
      
      Step 2: Second step here
      
      Step 3: Final step
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(3);
    });
  });

  describe('isEdgeCaseStep', () => {
    test('should identify edge case steps', () => {
      expect(StepsMarkdownParser.isEdgeCaseStep('Handle file not found error')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Check for multiple matches')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Process large file')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Handle corrupted documents')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Use binary reading mode')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Check size limits')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Ensure valid docx format')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('Reject invalid file')).toBe(true);
    });

    test('should return false for non-edge case steps', () => {
      expect(StepsMarkdownParser.isEdgeCaseStep('Locate the document')).toBe(false);
      expect(StepsMarkdownParser.isEdgeCaseStep('Convert to Base64')).toBe(false);
      expect(StepsMarkdownParser.isEdgeCaseStep('Call the API endpoint')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(StepsMarkdownParser.isEdgeCaseStep('FILE NOT FOUND')).toBe(true);
      expect(StepsMarkdownParser.isEdgeCaseStep('File Not Found')).toBe(true);
    });
  });

  describe('isExecutionStep', () => {
    test('should identify execution steps with action verbs', () => {
      expect(StepsMarkdownParser.isExecutionStep('locate the file')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('find the document')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('read the content')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('encode to Base64')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('call the API')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('save the result')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('write to file')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('create new document')).toBe(true);
    });

    test('should return false for non-execution steps', () => {
      expect(StepsMarkdownParser.isExecutionStep('The file should be located')).toBe(false);
      expect(StepsMarkdownParser.isExecutionStep('Check if file exists')).toBe(false);
      expect(StepsMarkdownParser.isExecutionStep('')).toBe(false);
    });

    test('should match verbs at word boundaries', () => {
      expect(StepsMarkdownParser.isExecutionStep('execute the plan')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('execution of step')).toBe(false); // "execution" not "execute"
    });

    test('should be case-insensitive', () => {
      expect(StepsMarkdownParser.isExecutionStep('LOCATE FILE')).toBe(true);
      expect(StepsMarkdownParser.isExecutionStep('Locate File')).toBe(true);
    });
  });

  describe('edge cases and robustness', () => {
    test('should handle empty input', () => {
      const result = StepsMarkdownParser.extractPlanAndSteps('');
      
      expect(result.hasPlan).toBe(false);
      expect(result.steps).toHaveLength(0);
      expect(result.planSection).toBeUndefined();
    });

    test('should handle malformed step numbering', () => {
      const text = `
      Plan:
      Step A: This won't be extracted
      Step 2b: Nor this one
      Step 3: This will be extracted
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].number).toBe(3);
    });

    test('should handle steps with very short descriptions', () => {
      const text = `
      Steps:
      1. Do it
      2. A longer meaningful description that should be extracted
      3. X
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].number).toBe(2);
    });

    test('should handle duplicate step numbers', () => {
      const text = `
      Plan:
      Step 1: First step
      Step 1: Duplicate step number
      Step 2: Second step
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(3); // All steps extracted despite duplicate numbers
    });

    test('should handle steps with special characters', () => {
      const text = `
      Steps:
      1. Handle file "test.docx"
      2. Use API endpoint: https://api.example.com
      3. Save result in folder: /path/to/output/
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].content).toContain('"test.docx"');
      expect(result.steps[1].content).toContain('https://api.example.com');
    });

    test('should handle steps with indentation', () => {
      const text = `
        Plan:
          Step 1:   First step with extra spaces
            Step 2: Indented step
        Step 3: Normal step
      `;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].content).toBe('First step with extra spaces');
    });
  });
});