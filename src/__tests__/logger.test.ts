import { logVerboseInfo, logLongMessage } from '../utils/logger';
import { ChatVerboseInfo, AssumptionVerboseInfo, ImplementationVerboseInfo } from '../utils/verboseInfo';

describe('Logger Tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on console.log and console.warn
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original implementations
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('logVerboseInfo', () => {
    it('should handle null/undefined verboseInfo gracefully', () => {
      logVerboseInfo(null, '');
      expect(consoleLogSpy).toHaveBeenCalledWith('[VerboseInfo] toString() called on null/undefined verboseInfo');

      consoleLogSpy.mockClear();
      logVerboseInfo(undefined, '');
      expect(consoleLogSpy).toHaveBeenCalledWith('[VerboseInfo] toString() called on null/undefined verboseInfo');
    });

    it('should log chat stage verboseInfo correctly', () => {
      const chatVerboseInfo: ChatVerboseInfo = {
        stage: 'chat',
        step: 1,
        maxSteps: 5,
        isComplete: false,
        problemSummary: {
          originalQuery: 'Create a greeting module',
          restatedProblem: 'You want to create a Python greeting module',
          extractedFrom: 'content',
          extractedAt: Date.now()
        },
        extractedFiles: {
          explicitFiles: [
            { path: 'hello.py', type: 'file', extractedAt: Date.now() }
          ],
          detectedFiles: []
        }
      };

      const formattedString = '📋 Chat Stage Verbose Info\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
      logVerboseInfo(chatVerboseInfo, formattedString);

      // Check that basic info is logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] 💬 toString() called for chat stage verboseInfo')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Progress: Step 1/5')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Problem restated:')
      );
      // Check that full formatted string is logged via logLongMessage
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Full toString() output')
      );
    });

    it('should log assumptions stage verboseInfo correctly', () => {
      const assumptionVerboseInfo: AssumptionVerboseInfo = {
        stage: 'assumptions',
        step: 2,
        maxSteps: 5,
        isComplete: false,
        progressPlan: {
          taskId: 'test-task-123',
          totalSteps: 3,
          complexity: 'simple',
          createdAt: Date.now(),
          steps: [
            {
              stepNumber: 1,
              goal: 'Create hello.py',
              status: 'completed',
              tools: ['create_file']
            },
            {
              stepNumber: 2,
              goal: 'Add greet function',
              status: 'in_progress',
              tools: ['replace_file']
            }
          ]
        }
      };

      const formattedString = '🔍 Assumptions Stage Verbose Info';
      logVerboseInfo(assumptionVerboseInfo, formattedString);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] 🔍 toString() called for assumptions stage verboseInfo')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] ProgressPlan created: 3 steps, complexity: simple')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Plan steps:')
      );
    });

    it('should log implementation stage verboseInfo correctly', () => {
      const implementationVerboseInfo: ImplementationVerboseInfo = {
        stage: 'implementation',
        step: 3,
        maxSteps: 5,
        isComplete: false,
        planProgress: {
          taskId: 'test-task-123',
          totalSteps: 3,
          completedSteps: 1,
          currentStep: {
            stepNumber: 2,
            goal: 'Add greet function',
            status: 'in_progress',
            startedAt: Date.now()
          },
          steps: [
            {
              stepNumber: 1,
              goal: 'Create hello.py',
              status: 'completed',
              completedAt: Date.now(),
              toolsUsed: ['create_file'],
              filesCreated: ['hello.py']
            },
            {
              stepNumber: 2,
              goal: 'Add greet function',
              status: 'in_progress',
              toolsUsed: ['replace_file']
            }
          ],
          planCompleted: false
        },
        fileOperations: {
          created: [
            { path: 'hello.py', source: 'codeContext', createdAt: Date.now() }
          ],
          updated: [],
          failed: []
        }
      };

      const formattedString = '⚙️ Implementation Stage Verbose Info';
      logVerboseInfo(implementationVerboseInfo, formattedString);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] ⚙️ toString() called for implementation stage verboseInfo')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Plan progress: 1/3 steps completed')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Current step:')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] File operations: 1 created, 0 updated, 0 failed')
      );
    });

    it('should log stage transition information', () => {
      const chatVerboseInfo: ChatVerboseInfo = {
        stage: 'chat',
        stageTransition: {
          from: 'chat',
          to: 'assumptions'
        },
        isComplete: true
      };

      const formattedString = 'Chat verbose info';
      logVerboseInfo(chatVerboseInfo, formattedString);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Current Stage: assumptions')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Status: Complete')
      );
    });

    it('should handle verboseInfo with unknown stage', () => {
      const unknownVerboseInfo = {
        stage: 'unknown-stage',
        isComplete: false
      } as any;

      const formattedString = 'Unknown stage info';
      logVerboseInfo(unknownVerboseInfo, formattedString);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] 📋 toString() called for unknown-stage stage verboseInfo')
      );
    });

    it('should handle verboseInfo with tool calls', () => {
      const chatVerboseInfo: ChatVerboseInfo = {
        stage: 'chat',
        toolCalls: [
          { name: 'read_file', stage: 'chat', success: true, file: 'test.txt' },
          { name: 'create_file', stage: 'chat', success: false, error: 'Permission denied' }
        ]
      };

      const formattedString = 'Chat with tool calls';
      logVerboseInfo(chatVerboseInfo, formattedString);

      // Should log basic info even with tool calls
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] 💬 toString() called for chat stage verboseInfo')
      );
    });

    it('should use logLongMessage for formatted string', () => {
      const chatVerboseInfo: ChatVerboseInfo = {
        stage: 'chat',
        isComplete: true
      };

      // Create a long formatted string to test logLongMessage
      const longFormattedString = 'A'.repeat(3000);
      logVerboseInfo(chatVerboseInfo, longFormattedString);

      // Should call logLongMessage which logs in chunks
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] Full toString() output (total length: 3000)')
      );
    });

    it('should handle verboseInfo with empty fileOperations', () => {
      const implementationVerboseInfo: ImplementationVerboseInfo = {
        stage: 'implementation',
        fileOperations: {
          created: [],
          updated: [],
          failed: []
        }
      };

      const formattedString = 'Implementation with empty file operations';
      logVerboseInfo(implementationVerboseInfo, formattedString);

      // Should not log file operations if all are empty
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[VerboseInfo] File operations:')
      );
    });
  });

  describe('logLongMessage', () => {
    it('should log short messages directly', () => {
      logLongMessage('[Test]', 'Short message', 1000);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test]: Short message');
    });

    it('should log empty messages', () => {
      logLongMessage('[Test]', '', 1000);
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test]: [EMPTY]');
    });

    it('should split long messages into chunks', () => {
      const longMessage = 'A'.repeat(2500);
      logLongMessage('[Test]', longMessage, 1000);

      // Should log total length first
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test] (total length: 2500)');
      // Should log in chunks
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test] chunk 1/3: ' + 'A'.repeat(1000));
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test] chunk 2/3: ' + 'A'.repeat(1000));
      expect(consoleLogSpy).toHaveBeenCalledWith('[Test] chunk 3/3: ' + 'A'.repeat(500));
    });
  });
});

