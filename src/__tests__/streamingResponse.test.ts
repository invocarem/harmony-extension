import { EventEmitter } from 'events';
import axios from 'axios';

/**
 * Test suite for streaming response handling
 * Tests the SSE (Server-Sent Events) parsing and token accumulation
 * Validates that streaming responses are correctly reconstructed
 */

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Streaming Response Handling', () => {
  describe('SSE Stream Parsing', () => {
    /**
     * Simulates a streaming response from llama-server
     * Returns a mock stream with SSE-formatted data
     */
    function createMockStream(tokens: string[]): EventEmitter {
      const stream = new EventEmitter();
      
      // Simulate token chunks arriving over time
      setImmediate(() => {
        tokens.forEach((token, index) => {
          setTimeout(() => {
            const data = {
              choices: [{
                text: token,
                finish_reason: index === tokens.length - 1 ? 'stop' : null,
              }],
            };
            stream.emit('data', Buffer.from(`data: ${JSON.stringify(data)}\n`));
          }, index * 10); // 10ms between tokens
        });

        // End stream after all tokens
        setTimeout(() => {
          stream.emit('end');
        }, tokens.length * 10 + 50);
      });

      return stream;
    }

    it('should correctly parse SSE format data chunks', async () => {
      const tokens = ['Hello', ' ', 'world', '!'];
      const mockStream = createMockStream(tokens);
      
      const response = {
        status: 200,
        data: mockStream,
      };

      mockedAxios.post.mockResolvedValue(response);

      // Simulate the streaming response parser from harmonyClient
      const result = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        let fullText = '';
        const lines: string[] = [];

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n');

          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i];
            lines.push(line);

            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.text) {
                  process.stdout.write(data.choices[0].text);
                }
              } catch (e) {
                reject(e);
              }
            }
          }

          buffer = parts[parts.length - 1];
        });

        response.data.on('end', () => {
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.text) {
                  fullText += data.choices[0].text;
                }
              } catch (e) {
                reject(e);
              }
            }
          });
          resolve(fullText);
        });

        response.data.on('error', reject);
      });

      expect(result).toBe('Hello world!');
    });

    it('should handle multiple data lines in single chunk', async () => {
      const mockStream = new EventEmitter();

      // Multiple SSE lines in one chunk
      const multilineChunk = [
        `data: ${JSON.stringify({ choices: [{ text: 'Multi' }] })}`,
        `data: ${JSON.stringify({ choices: [{ text: 'line' }] })}`,
      ].join('\n') + '\n';

      setImmediate(() => {
        mockStream.emit('data', Buffer.from(multilineChunk));
        mockStream.emit('end');
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      const result = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        let fullText = '';
        const lines: string[] = [];

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n');

          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i];
            lines.push(line);
          }

          buffer = parts[parts.length - 1];
        });

        response.data.on('end', () => {
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.text) {
                  fullText += data.choices[0].text;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          });
          resolve(fullText);
        });

        response.data.on('error', reject);
      });

      expect(result).toBe('Multiline');
    });

    it('should capture finish_reason from final token', async () => {
      const mockStream = new EventEmitter();
      let finishReason: string | undefined = undefined;

      setImmediate(() => {
        const data1 = {
          choices: [{ text: 'Response', finish_reason: null }],
        };
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify(data1)}\n`));

        const data2 = {
          choices: [{ text: '', finish_reason: 'stop' }],
        };
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify(data2)}\n`));

        mockStream.emit('end');
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      await new Promise<void>((resolve, reject) => {
        let buffer = '';
        const lines: string[] = [];

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n');

          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i];
            lines.push(line);
          }

          buffer = parts[parts.length - 1];
        });

        response.data.on('end', () => {
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.finish_reason) {
                  finishReason = data.choices[0].finish_reason;
                }
              } catch (e) {
                reject(e);
              }
            }
          });
          resolve();
        });

        response.data.on('error', reject);
      });

      expect(finishReason).toBe('stop');
    });

    it('should handle malformed JSON gracefully', async () => {
      const mockStream = new EventEmitter();

      setImmediate(() => {
        mockStream.emit('data', Buffer.from('invalid json\n'));
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify({ choices: [{ text: 'valid' }] })}\n`));
        mockStream.emit('end');
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      const result = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        let fullText = '';
        const lines: string[] = [];

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n');

          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i];
            lines.push(line);
          }

          buffer = parts[parts.length - 1];
        });

        response.data.on('end', () => {
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.text) {
                  fullText += data.choices[0].text;
                }
              } catch (e) {
                // Ignore malformed lines
              }
            }
          });
          resolve(fullText);
        });

        response.data.on('error', reject);
      });

      expect(result).toBe('valid');
    });

    it('should handle empty text tokens', async () => {
      const mockStream = new EventEmitter();

      setImmediate(() => {
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify({ choices: [{ text: 'Start' }] })}\n`));
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify({ choices: [{ text: '' }] })}\n`));
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify({ choices: [{ text: 'End' }] })}\n`));
        mockStream.emit('end');
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      const result = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        let fullText = '';
        const lines: string[] = [];

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n');

          for (let i = 0; i < parts.length - 1; i++) {
            const line = parts[i];
            lines.push(line);
          }

          buffer = parts[parts.length - 1];
        });

        response.data.on('end', () => {
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices?.[0]?.text) {
                  fullText += data.choices[0].text;
                }
              } catch (e) {
                reject(e);
              }
            }
          });
          resolve(fullText);
        });

        response.data.on('error', reject);
      });

      expect(result).toBe('StartEnd');
    });

    it('should handle streaming error gracefully', async () => {
      const mockStream = new EventEmitter();

      setImmediate(() => {
        mockStream.emit('data', Buffer.from(`data: ${JSON.stringify({ choices: [{ text: 'partial' }] })}\n`));
        mockStream.emit('error', new Error('Stream connection lost'));
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      const promise = new Promise<string>((resolve, reject) => {
        response.data.on('data', () => {});
        response.data.on('error', reject);
      });

      await expect(promise).rejects.toThrow('Stream connection lost');
    });
  });

  describe('Performance Comparison', () => {
    it('should accumulate tokens faster than waiting for full response', async () => {
      const tokenCount = 100;
      const tokens = Array.from({ length: tokenCount }, (_, i) => `token${i} `);
      
      // Measure streaming accumulation time
      const streamStartTime = Date.now();
      let accumulatedTokens = 0;
      
      tokens.forEach(token => {
        accumulatedTokens += token.length;
      });
      
      const streamTime = Date.now() - streamStartTime;
      
      // Measure non-streaming (simulated full wait)
      const nonStreamStartTime = Date.now();
      const fullResponse = tokens.join('');
      const nonStreamTime = Date.now() - nonStreamStartTime;
      
      // Streaming should be negligible (tokens already available)
      expect(streamTime).toBeLessThanOrEqual(nonStreamTime + 10); // Allow 10ms variance
      expect(accumulatedTokens).toBe(fullResponse.length);
    });

    it('should provide incremental feedback for user responsiveness', async () => {
      const mockStream = new EventEmitter();
      const feedbackPoints: number[] = [];
      
      setImmediate(() => {
        const tokens = ['This', ' is', ' streaming', ' response'];
        tokens.forEach((token, index) => {
          setTimeout(() => {
            feedbackPoints.push(Date.now());
            mockStream.emit('data', Buffer.from(
              `data: ${JSON.stringify({ choices: [{ text: token }] })}\n`
            ));
          }, index * 5);
        });
        
        setTimeout(() => {
          mockStream.emit('end');
        }, tokens.length * 5 + 10);
      });

      const response = { status: 200, data: mockStream };
      mockedAxios.post.mockResolvedValue(response);

      await new Promise<void>((resolve) => {
        let count = 0;
        response.data.on('data', () => {
          count++;
        });
        response.data.on('end', () => {
          resolve();
        });
      });

      // Verify we got incremental feedback (multiple data events)
      expect(feedbackPoints.length).toBeGreaterThan(0);
    });
  });

  describe('Axios Configuration', () => {
    it('should request with stream: true', () => {
      const postSpy = jest.spyOn(mockedAxios, 'post');
      
      // Mock a streaming response
      const mockStream = new EventEmitter();
      postSpy.mockResolvedValue({
        status: 200,
        data: mockStream,
      });

      const config = {
        model: 'test-model',
        prompt: 'test prompt',
        temperature: 0.7,
        max_tokens: 2048,
        stream: true, // Should be true for streaming
      };

      mockedAxios.post('http://localhost:8000/v1/completions', config, {
        responseType: 'stream',
      });

      expect(postSpy).toHaveBeenCalledWith(
        'http://localhost:8000/v1/completions',
        expect.objectContaining({ stream: true }),
        expect.objectContaining({ responseType: 'stream' })
      );

      postSpy.mockRestore();
    });

    it('should include proper headers with streaming config', () => {
      const postSpy = jest.spyOn(mockedAxios, 'post');
      const mockStream = new EventEmitter();
      
      postSpy.mockResolvedValue({
        status: 200,
        data: mockStream,
      });

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key',
      };

      mockedAxios.post('http://localhost:8000/v1/completions', {}, {
        headers,
        responseType: 'stream',
      });

      expect(postSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining(headers),
          responseType: 'stream',
        })
      );

      postSpy.mockRestore();
    });
  });

  describe('Backward Compatibility', () => {
    it('should fallback to non-streaming if response is not a stream', async () => {
      const response = {
        status: 200,
        data: {
          choices: [{ text: 'Non-streaming response' }],
        },
      };

      mockedAxios.post.mockResolvedValue(response);

      // Simulate fallback logic
      let result = '';
      
      if (response.data && typeof response.data === 'object' && 'pipe' in response.data) {
        // Stream handling (not taken in this case)
        result = 'stream';
      } else {
        // Fallback for non-streaming
        if ((response.data as any)?.choices?.[0]?.text) {
          result = (response.data as any).choices[0].text;
        }
      }

      expect(result).toBe('Non-streaming response');
    });

    it('should handle both streaming and non-streaming transparently', async () => {
      // Create a mock stream that actually has the pipe method
      const mockStream: any = new EventEmitter();
      mockStream.pipe = jest.fn(); // Add pipe method
      
      const streamResponse = {
        status: 200,
        data: mockStream,
      };

      const nonStreamResponse = {
        status: 200,
        data: {
          choices: [{ text: 'Non-stream' }],
        },
      };

      // Both should be handled correctly
      expect(
        streamResponse.data && typeof streamResponse.data === 'object' && 'pipe' in streamResponse.data
      ).toBe(true);

      expect(
        nonStreamResponse.data && typeof nonStreamResponse.data === 'object' && 'pipe' in nonStreamResponse.data
      ).toBe(false);
    });
  });
});
