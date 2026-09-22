import { ConfigService } from '@nestjs/config';
import {
  ChatbotApiService,
  type FeedbackGradingInput,
} from './chatbot-api.service';

const grading: FeedbackGradingInput = {
  questionText: 'Explain.',
  mechanicalFacts: '{}',
  rubric: 'Award points for accuracy.',
  feedbackInstructions: '',
  humanReviewCriteria: '',
  scoreContract: 'Any score from 0 through 2 in increments of 0.5.',
  capContract: 'No triggered automatic check limits the score.',
  automaticChecks: '- No automatic checks are configured.',
};

describe('ChatbotApiService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('returns a valid structured feedback response', async () => {
    const testApiUrl = 'https://chatbot.test';
    const configService = new ConfigService({
      CHATBOT_API_URL: testApiUrl,
      CHATBOT_API_KEY: 'test-chatbot-api-key',
    });
    const service = new ChatbotApiService(configService);

    const expectedAnswer = {
      score: 2,
      comment: 'Thoughtful reflection meeting the criteria.',
      reasons: ['both required examples were included'],
      human_review_reason: null,
    };

    const mockFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    mockFetch.mockResolvedValueOnce(
      new Response(
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
      ),
    );
    global.fetch = mockFetch;

    const result = await service.queryFeedback('user prompt', 42, grading);

    expect(result).toEqual({
      answer: expectedAnswer,
      model: 'test-model',
    });

    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(String(requestUrl)).toBe(`${testApiUrl}/chatbot/query`);
    const requestBody: unknown = JSON.parse(String(requestInit?.body));
    expect(requestBody).toMatchObject({
      query: 'user prompt',
      type: 'feedback',
      courseId: 42,
      params: { grading },
    });
  });

  it.each([
    [
      { message: 'Request exceeds context size', error: 'Bad Request' },
      'Request exceeds context size',
    ],
    [
      {
        message: ['query must be a string', 'courseId must be an integer'],
        error: 'Bad Request',
      },
      'query must be a string; courseId must be an integer',
    ],
    [{ error: 'Legacy provider error' }, 'Legacy provider error'],
    ['Provider unavailable', 'Provider unavailable'],
  ])(
    'preserves the useful upstream error: %j',
    async (body, expectedMessage) => {
      const service = new ChatbotApiService(
        new ConfigService({ CHATBOT_API_URL: 'https://chatbot.test' }),
      );
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: 400,
        }),
      );
      await expect(
        service.queryFeedback('answer', 42, grading),
      ).rejects.toMatchObject({
        status: 400,
        message: expectedMessage,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a malformed response envelope at the runtime boundary', async () => {
    const configService = new ConfigService({
      CHATBOT_API_URL: 'https://chatbot.test',
      CHATBOT_API_KEY: 'test-chatbot-api-key',
    });
    const service = new ChatbotApiService(configService);

    const mockFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify('not an envelope'), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    global.fetch = mockFetch;

    await expect(
      service.queryFeedback('user prompt', 42, grading),
    ).rejects.toThrow();
  });
});
