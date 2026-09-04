import { ConfigService } from '@nestjs/config';
import { ChatbotApiService } from './chatbot-api.service';

describe('ChatbotApiService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('queries chatbot for course with structured feedback successfully', async () => {
    const testApiUrl = 'https://chatbot.test';
    const testApiKey = 'test-chatbot-api-key';

    const configService = new ConfigService({
      CHATBOT_API_URL: testApiUrl,
      CHATBOT_API_KEY: testApiKey,
    });
    const service = new ChatbotApiService(configService);

    const expectedAnswer = {
      score: 2,
      comment: 'Thoughtful reflection meeting the criteria.',
      reasons: ['meets_requirements'],
      needs_human_review: false,
    };

    const mockResponse = new Response(
      JSON.stringify({
        answer: expectedAnswer,
        model: 'test-model',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const mockFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    mockFetch.mockResolvedValueOnce(mockResponse);
    global.fetch = mockFetch;

    const result = await service.queryChatbotForCourse(
      'user prompt',
      42,
      'feedback',
      { systemPrompt: 'system prompt' },
    );

    expect(result).toEqual({
      answer: expectedAnswer,
      model: 'test-model',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [firstArgument, secondArgument] = mockFetch.mock.calls[0];
    expect(String(firstArgument)).toBe(`${testApiUrl}/chatbot/query`);
    expect(secondArgument?.method).toBe('POST');
    expect(secondArgument?.headers).toEqual({
      'Content-Type': 'application/json',
      'HMS-API-KEY': testApiKey,
    });
    expect(secondArgument?.headers).not.toHaveProperty('HMS_API_TOKEN');
    expect(secondArgument?.body).toBe(
      JSON.stringify({
        query: 'user prompt',
        type: 'feedback',
        courseId: 42,
        params: { systemPrompt: 'system prompt' },
      }),
    );
  });
});
