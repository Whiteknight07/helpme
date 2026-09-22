import { LMSApiResponseStatus } from '@koh/common';
import { LMSCourseIntegrationModel } from './lmsCourseIntegration.entity';
import { CanvasLMSAdapter } from './lmsIntegration.adapter';

const COURSE_ID = 42;
const BASE_URL = 'https://canvas.example.test';
const LOOKUP_UUID = '11111111-1111-4111-8111-111111111111';
const originalFetch = global.fetch;

function adapter(): CanvasLMSAdapter {
  return new CanvasLMSAdapter({
    apiCourseId: COURSE_ID,
    apiKey: 'test-api-key',
    apiKeyExpiry: null,
    accessTokenId: null,
    orgIntegration: {
      apiPlatform: 'Canvas',
      rootUrl: 'canvas.example.test',
      secure: true,
    },
  } as unknown as LMSCourseIntegrationModel);
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new URL(String(input)), init),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('CanvasLMSAdapter Classic quiz grading', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    [401, LMSApiResponseStatus.Unauthorized],
    [403, LMSApiResponseStatus.Forbidden],
  ])(
    'preserves permission failures for GET and PUT (%s)',
    async (status, message) => {
      for (const body of [
        '<html>Access denied</html>',
        JSON.stringify({ errors: [{ message: 'Denied' }] }),
      ]) {
        mockFetch(() => new Response(body, { status }));
        expect((await adapter().getClassicQuizCatalog(7)).status).toBe(message);
        expect(
          (
            await adapter().getClassicAttemptSnapshots({
              quizId: 7,
              assignmentId: 700,
            })
          ).status,
        ).toBe(message);
        const fetchMock = mockFetch(() => new Response(body, { status }));
        expect(
          await adapter().putClassicAttemptGrades({
            quizId: 7,
            quizSubmissionId: 8,
            attempt: 1,
            questions: [{ questionId: 11, score: 2, comment: 'Feedback' }],
          }),
        ).toEqual({ outcome: 'rejected', httpStatus: status, message });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('does not retry a write with an unknown transport outcome', async () => {
    const fetchMock = mockFetch(() => {
      throw new Error('Socket closed');
    });
    expect(
      await adapter().putClassicAttemptGrades({
        quizId: 7,
        quizSubmissionId: 8,
        attempt: 1,
        questions: [{ questionId: 11, score: 2, comment: 'Feedback' }],
      }),
    ).toMatchObject({ outcome: 'unknown', message: 'Socket closed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps embedded essay questions from a selected quiz', async () => {
    mockFetch((url) => {
      if (url.pathname.endsWith('/quizzes')) {
        return response([
          { id: 7, title: 'Essay quiz', published: true, assignment_id: 700 },
        ]);
      }
      if (url.pathname.endsWith('/assignments')) {
        return response([{ id: 700, post_manually: true }]);
      }
      if (url.pathname.endsWith('/quizzes/7/questions')) {
        return response([
          {
            id: 11,
            position: 1,
            question_text: `Explain why<iframe src="/retrieve?resource_link_lookup_uuid=${LOOKUP_UUID}"></iframe>`,
            question_type: 'essay_question',
            points_possible: 5,
          },
        ]);
      }
      if (url.pathname.includes('/lti_resource_links/')) {
        return response({
          lookup_uuid: LOOKUP_UUID,
          custom: { helpme_question_id: '101' },
        });
      }
      throw new Error(`Unexpected Canvas request: ${url}`);
    });

    const result = await adapter().getClassicQuizCatalog(7);

    expect(result).toEqual({
      status: LMSApiResponseStatus.Success,
      quizzes: [
        {
          quizId: 7,
          title: 'Essay quiz',
          assignmentId: 700,
          postManually: true,
          speedGraderUrl: `${BASE_URL}/courses/${COURSE_ID}/gradebook/speed_grader?assignment_id=700`,
          essayQuestions: [
            {
              id: 11,
              position: 1,
              text: 'Explain why',
              points: 5,
              mapping: {
                status: 'detected',
                lookupUuid: LOOKUP_UUID,
                embeddableQuestionId: 101,
              },
            },
          ],
        },
      ],
    });
  });

  it('reads completed essay attempts', async () => {
    mockFetch((url) => {
      if (url.pathname.endsWith('/quizzes/7/submissions')) {
        return response({
          quiz_submissions: [
            {
              id: 1002,
              quiz_id: 7,
              user_id: 5,
              attempt: 1,
              workflow_state: 'complete',
            },
          ],
        });
      }
      if (url.pathname.endsWith('/assignments/700/submissions')) {
        return response([
          {
            user_id: 5,
            attempt: 1,
            excused: false,
            posted_at: null,
            submission_history: [
              {
                attempt: 1,
                submission_data: [
                  {
                    question_id: 11,
                    text: '<p>Student answer</p>',
                    points: 0,
                    correct: 'undefined',
                    comment: null,
                  },
                ],
              },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected Canvas request: ${url}`);
    });

    const result = await adapter().getClassicAttemptSnapshots({
      quizId: 7,
      assignmentId: 700,
    });

    expect(result.snapshot?.attempts).toEqual([
      {
        quizSubmissionId: 1002,
        userId: 5,
        attempt: 1,
        postedAt: null,
        excused: false,
        readable: true,
        answers: [
          {
            questionId: 11,
            text: 'Student answer',
            points: null,
            comment: null,
          },
        ],
      },
    ]);
  });

  it('sends every question grade in one Canvas request', async () => {
    const fetchMock = mockFetch(() => response({}));

    await adapter().putClassicAttemptGrades({
      quizId: 7,
      quizSubmissionId: 1002,
      attempt: 1,
      questions: [
        { questionId: 11, score: 4, comment: 'Good work.' },
        { questionId: 12, score: 0, comment: 'No answer was submitted.' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/7/submissions/1002`,
    );
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      quiz_submissions: [
        {
          attempt: 1,
          questions: {
            '11': { score: 4, comment: 'Good work.' },
            '12': { score: 0, comment: 'No answer was submitted.' },
          },
        },
      ],
    });
  });
});
