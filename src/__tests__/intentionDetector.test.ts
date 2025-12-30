import { IntentionDetector, UserIntent } from '../harmony/intentionDetector';

describe('IntentionDetector', () => {
  let detector: IntentionDetector;

  beforeEach(() => {
    detector = new IntentionDetector();
  });

  describe('detectIntent', () => {
    describe('EXPLAIN intent', () => {
      it('should detect explain intent from "explain" keyword', () => {
        expect(detector.detectIntent('explain code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('explain this function')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('can you explain')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "what does" pattern', () => {
        expect(detector.detectIntent('what does this code do')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('what does the function do')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "how does" pattern', () => {
        expect(detector.detectIntent('how does this work')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('how does the algorithm work')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "describe" keyword', () => {
        expect(detector.detectIntent('describe the code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('describe this function')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "walkthrough" keyword', () => {
        expect(detector.detectIntent('walkthrough of the code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('walk through this')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "tell me about" pattern', () => {
        expect(detector.detectIntent('tell me about this code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('tell me about the function')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "what is" pattern', () => {
        expect(detector.detectIntent('what is this code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('what is the purpose')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "show me how" pattern', () => {
        expect(detector.detectIntent('show me how this works')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "can you" + explain pattern', () => {
        expect(detector.detectIntent('can you explain this')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('could you explain')).toBe(UserIntent.EXPLAIN);
      });

      it('should detect explain intent from "clear walkthrough" pattern', () => {
        expect(detector.detectIntent('clear walkthrough of the code')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('detailed explanation')).toBe(UserIntent.EXPLAIN);
      });

      it('should be case insensitive', () => {
        expect(detector.detectIntent('EXPLAIN CODE')).toBe(UserIntent.EXPLAIN);
        expect(detector.detectIntent('What Does This Do')).toBe(UserIntent.EXPLAIN);
      });
    });

    describe('REVIEW intent', () => {
      it('should detect review intent from "review" keyword', () => {
        expect(detector.detectIntent('review this code')).toBe(UserIntent.REVIEW);
        expect(detector.detectIntent('review the file')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "check" keyword', () => {
        expect(detector.detectIntent('check this code')).toBe(UserIntent.REVIEW);
        expect(detector.detectIntent('check if this is correct')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "analyze" keyword', () => {
        expect(detector.detectIntent('analyze this code')).toBe(UserIntent.REVIEW);
        expect(detector.detectIntent('analyze the function')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "evaluate" keyword', () => {
        expect(detector.detectIntent('evaluate this code')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "inspect" keyword', () => {
        expect(detector.detectIntent('inspect this code')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "examine" keyword', () => {
        expect(detector.detectIntent('examine this code')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "look at" pattern', () => {
        expect(detector.detectIntent('look at this code')).toBe(UserIntent.REVIEW);
      });

      it('should detect review intent from "let\'s look" pattern', () => {
        expect(detector.detectIntent("let's look at this")).toBe(UserIntent.REVIEW);
        expect(detector.detectIntent('let us examine this')).toBe(UserIntent.REVIEW);
      });
    });

    describe('CREATE intent', () => {
      it('should detect create intent from "create" keyword', () => {
        expect(detector.detectIntent('create a file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('create new code')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "write" keyword', () => {
        expect(detector.detectIntent('write a function')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('write code for')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "generate" keyword', () => {
        expect(detector.detectIntent('generate a script')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('generate code')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "make" keyword', () => {
        expect(detector.detectIntent('make a file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('make new code')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "new" keyword', () => {
        expect(detector.detectIntent('new file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('new function')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "implement" keyword', () => {
        expect(detector.detectIntent('implement a feature')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('implement this')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "build" keyword', () => {
        expect(detector.detectIntent('build a script')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "set up" pattern', () => {
        expect(detector.detectIntent('set up a file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('set up new code')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "initialize" keyword', () => {
        expect(detector.detectIntent('initialize a project')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "add a file" pattern', () => {
        expect(detector.detectIntent('add a file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('add an new file')).toBe(UserIntent.CREATE);
      });

      it('should detect create intent from "I need to create" pattern', () => {
        expect(detector.detectIntent('I need to create a file')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent('I want to write code')).toBe(UserIntent.CREATE);
        expect(detector.detectIntent("I'd like to generate")).toBe(UserIntent.CREATE);
      });
    });

    describe('REFACTOR intent', () => {
      it('should detect refactor intent from "refactor" keyword', () => {
        expect(detector.detectIntent('refactor this code')).toBe(UserIntent.REFACTOR);
        expect(detector.detectIntent('refactor the function')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "improve" keyword', () => {
        expect(detector.detectIntent('improve this code')).toBe(UserIntent.REFACTOR);
        expect(detector.detectIntent('improve the function')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "optimize" keyword', () => {
        expect(detector.detectIntent('optimize this code')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "clean up" pattern', () => {
        expect(detector.detectIntent('clean up this code')).toBe(UserIntent.REFACTOR);
        expect(detector.detectIntent('cleanup the file')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "restructure" keyword', () => {
        expect(detector.detectIntent('restructure this code')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "reorganize" keyword', () => {
        expect(detector.detectIntent('reorganize this code')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "modernize" keyword', () => {
        expect(detector.detectIntent('modernize this code')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "enhance" keyword', () => {
        expect(detector.detectIntent('enhance this code')).toBe(UserIntent.REFACTOR);
      });

      it('should detect refactor intent from "make it better" pattern', () => {
        expect(detector.detectIntent('make it better')).toBe(UserIntent.REFACTOR);
        expect(detector.detectIntent('make this cleaner')).toBe(UserIntent.REFACTOR);
        expect(detector.detectIntent('make it more efficient')).toBe(UserIntent.REFACTOR);
      });
    });

    describe('MODIFY intent', () => {
      it('should detect modify intent from "change" keyword', () => {
        expect(detector.detectIntent('change this code')).toBe(UserIntent.MODIFY);
        expect(detector.detectIntent('change the function')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "update" keyword', () => {
        expect(detector.detectIntent('update this code')).toBe(UserIntent.MODIFY);
        expect(detector.detectIntent('update the file')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "edit" keyword', () => {
        expect(detector.detectIntent('edit this code')).toBe(UserIntent.MODIFY);
        expect(detector.detectIntent('edit the file')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "modify" keyword', () => {
        expect(detector.detectIntent('modify this code')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "fix" keyword', () => {
        expect(detector.detectIntent('fix this code')).toBe(UserIntent.MODIFY);
        expect(detector.detectIntent('fix the bug')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "correct" keyword', () => {
        expect(detector.detectIntent('correct this code')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "adjust" keyword', () => {
        expect(detector.detectIntent('adjust this code')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "alter" keyword', () => {
        expect(detector.detectIntent('alter this code')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "replace" keyword', () => {
        expect(detector.detectIntent('replace this code')).toBe(UserIntent.MODIFY);
      });

      it('should detect modify intent from "I need to change" pattern', () => {
        expect(detector.detectIntent('I need to change this')).toBe(UserIntent.MODIFY);
        expect(detector.detectIntent('I want to update')).toBe(UserIntent.MODIFY);
      });
    });

    describe('DEBUG intent', () => {
      it('should detect debug intent from "debug" keyword', () => {
        expect(detector.detectIntent('debug this code')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('debug the issue')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "fix error" pattern', () => {
        expect(detector.detectIntent('fix error')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('fix this error')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "why is" pattern', () => {
        expect(detector.detectIntent('why is this not working')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('why is it broken')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "what\'s wrong" pattern', () => {
        expect(detector.detectIntent("what's wrong")).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent("what's wrong with this")).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "troubleshoot" keyword', () => {
        expect(detector.detectIntent('troubleshoot this')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "resolve" keyword', () => {
        expect(detector.detectIntent('resolve this issue')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "solve" keyword', () => {
        expect(detector.detectIntent('solve this problem')).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from error-related keywords', () => {
        expect(detector.detectIntent('there is an error')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('this has a bug')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('there is an issue')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('this is broken')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('not working')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent("doesn't work")).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent("isn't working")).toBe(UserIntent.DEBUG);
      });

      it('should detect debug intent from "fix" + error pattern', () => {
        expect(detector.detectIntent('fix error')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('fixing bug')).toBe(UserIntent.DEBUG);
        expect(detector.detectIntent('fixed issue')).toBe(UserIntent.DEBUG);
      });
    });

    describe('UNKNOWN intent', () => {
      it('should return UNKNOWN for empty string', () => {
        expect(detector.detectIntent('')).toBe(UserIntent.UNKNOWN);
      });

      it('should return UNKNOWN for whitespace only', () => {
        expect(detector.detectIntent('   ')).toBe(UserIntent.UNKNOWN);
        expect(detector.detectIntent('\n\t')).toBe(UserIntent.UNKNOWN);
      });

      it('should return UNKNOWN for ambiguous queries', () => {
        expect(detector.detectIntent('hello')).toBe(UserIntent.UNKNOWN);
        expect(detector.detectIntent('what time is it')).toBe(UserIntent.UNKNOWN);
        expect(detector.detectIntent('help me')).toBe(UserIntent.UNKNOWN);
      });

      it('should return UNKNOWN for queries that don\'t match any pattern', () => {
        expect(detector.detectIntent('run the tests')).toBe(UserIntent.UNKNOWN);
        expect(detector.detectIntent('deploy the app')).toBe(UserIntent.UNKNOWN);
      });
    });

    describe('Priority handling', () => {
      it('should prioritize EXPLAIN over other intents', () => {
        // Even if it contains "create", if it starts with "explain", it's EXPLAIN
        expect(detector.detectIntent('explain how to create a file')).toBe(UserIntent.EXPLAIN);
      });

      it('should prioritize REVIEW over CREATE/MODIFY', () => {
        expect(detector.detectIntent('review and create')).toBe(UserIntent.REVIEW);
      });

      it('should detect first matching intent in order', () => {
        // EXPLAIN is checked first, so it wins
        expect(detector.detectIntent('explain how to refactor')).toBe(UserIntent.EXPLAIN);
      });
    });
  });

  describe('shouldAllowFileExtraction', () => {
    it('should allow extraction for CREATE intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.CREATE)).toBe(true);
    });

    it('should allow extraction for REFACTOR intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.REFACTOR)).toBe(true);
    });

    it('should allow extraction for MODIFY intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.MODIFY)).toBe(true);
    });

    it('should allow extraction for DEBUG intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.DEBUG)).toBe(true);
    });

    it('should disallow extraction for EXPLAIN intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.EXPLAIN)).toBe(false);
    });

    it('should disallow extraction for REVIEW intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.REVIEW)).toBe(false);
    });

    it('should disallow extraction for UNKNOWN intent', () => {
      expect(detector.shouldAllowFileExtraction(UserIntent.UNKNOWN)).toBe(false);
    });
  });

  describe('Integration tests', () => {
    it('should correctly identify explain intent and disallow extraction', () => {
      const intent = detector.detectIntent('explain code');
      expect(intent).toBe(UserIntent.EXPLAIN);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(false);
    });

    it('should correctly identify create intent and allow extraction', () => {
      const intent = detector.detectIntent('create a new file');
      expect(intent).toBe(UserIntent.CREATE);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(true);
    });

    it('should correctly identify refactor intent and allow extraction', () => {
      const intent = detector.detectIntent('refactor this code');
      expect(intent).toBe(UserIntent.REFACTOR);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(true);
    });

    it('should correctly identify modify intent and allow extraction', () => {
      const intent = detector.detectIntent('update this file');
      expect(intent).toBe(UserIntent.MODIFY);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(true);
    });

    it('should correctly identify debug intent and allow extraction', () => {
      const intent = detector.detectIntent('fix this error');
      expect(intent).toBe(UserIntent.DEBUG);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(true);
    });

    it('should correctly identify review intent and disallow extraction', () => {
      const intent = detector.detectIntent('review this code');
      expect(intent).toBe(UserIntent.REVIEW);
      expect(detector.shouldAllowFileExtraction(intent)).toBe(false);
    });
  });
});

