/**
 * Test helper functions for HarmonyClient tests
 * Provides utilities for stage transitions and common test setup
 */

import { HarmonyClient } from '../harmonyClient';
import { HarmonyProcessor, HarmonyParseResult } from '../harmonyProcessor';
import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Transition HarmonyClient from current stage to assumptions stage
 * Uses explicit "move to assumptions" command
 * Returns a response with steps to ensure a plan is created
 */
export async function transitionToAssumptions(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  // Return a response with steps so a plan gets created
  // This is needed because implementation stage requires a plan
  // The steps should mention file creation to ensure needsFileCreation is true
  const contentWithSteps = 'Here is the plan:\nStep 1: Create the file using create_file\nStep 2: Verify the file';
  const mockResponse = {
    status: 200,
    data: {
      choices: [{ text: `<|channel|>final<|message|>${contentWithSteps}<|end|>` }],
    },
  };

  mockedAxios.post.mockResolvedValueOnce(mockResponse);

  const parseResult: HarmonyParseResult = {
    content: contentWithSteps,
    rawToolCalls: [],
  };

  mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);
  mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

  await client.callServer('move to assumptions');
}

/**
 * Transition HarmonyClient from assumptions stage to implementation stage
 * Uses explicit "move to implementation" command
 * 
 * Note: When "move to implementation" is called, it first processes in assumptions stage
 * to generate/complete the plan, then transitions to implementation stage.
 * This helper mocks both the assumptions stage LLM call and the transition.
 */
export async function transitionToImplementation(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  // First, mock the assumptions stage LLM call that happens when "move to implementation" is called
  // This call processes the command in assumptions stage to generate/complete the plan
  const assumptionsStageResponse = {
    status: 200,
    data: {
      choices: [{ text: '<|channel|>final<|message|>Here is the complete plan:\nStep 1: Create the file\nStep 2: Verify the file<|end|>' }],
    },
  };

  mockedAxios.post.mockResolvedValueOnce(assumptionsStageResponse);

  const assumptionsParseResult: HarmonyParseResult = {
    content: 'Here is the complete plan:\nStep 1: Create the file\nStep 2: Verify the file',
    rawToolCalls: [],
  };

  mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
  mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

  await client.callServer('move to implementation');
}

/**
 * Transition HarmonyClient through assumptions to implementation stage
 * Convenience function that does both transitions
 */
export async function transitionToImplementationViaAssumptions(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  await transitionToAssumptions(client, mockHarmonyProcessor);
  await transitionToImplementation(client, mockHarmonyProcessor);
}

/**
 * Create a mock response for HarmonyClient API calls
 */
export function createMockResponse(content: string): { status: number; data: { choices: Array<{ text: string }> } } {
  return {
    status: 200,
    data: {
      choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
    },
  };
}

/**
 * Create a mock parse result for HarmonyProcessor
 */
export function createParseResult(content: string, rawToolCalls: string[] = []): HarmonyParseResult {
  return {
    content,
    rawToolCalls,
    reasoning: undefined,
    commentary: undefined,
    final: undefined,
  };
}

// Dummy test to satisfy Jest (this file contains test helpers, not tests)
describe('testHelpers', () => {
  it('should export helper functions', () => {
    expect(typeof transitionToAssumptions).toBe('function');
    expect(typeof transitionToImplementation).toBe('function');
    expect(typeof transitionToImplementationViaAssumptions).toBe('function');
    expect(typeof createMockResponse).toBe('function');
    expect(typeof createParseResult).toBe('function');
  });
});

