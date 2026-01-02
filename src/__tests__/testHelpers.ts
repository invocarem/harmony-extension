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
 */
export async function transitionToAssumptions(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  const mockResponse = {
    status: 200,
    data: {
      choices: [{ text: '<|channel|>final<|message|>Moving to assumptions stage<|end|>' }],
    },
  };

  mockedAxios.post.mockResolvedValueOnce(mockResponse);

  const parseResult: HarmonyParseResult = {
    content: 'Moving to assumptions stage',
    rawToolCalls: [],
  };

  mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);
  mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

  await client.callServer('move to assumptions');
}

/**
 * Transition HarmonyClient from assumptions stage to implementation stage
 * Uses explicit "move to implementation" command
 */
export async function transitionToImplementation(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  const mockResponse = {
    status: 200,
    data: {
      choices: [{ text: '<|channel|>final<|message|>Moving to implementation stage<|end|>' }],
    },
  };

  mockedAxios.post.mockResolvedValueOnce(mockResponse);

  const parseResult: HarmonyParseResult = {
    content: 'Moving to implementation stage',
    rawToolCalls: [],
  };

  mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);
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

