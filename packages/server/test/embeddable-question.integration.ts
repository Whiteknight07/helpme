import { setupIntegrationTest } from './util/testUtils';
import { LtiModule } from '../src/lti/lti.module';
import { ChatbotApiService } from '../src/chatbot/chatbot-api.service';
import {
  CourseFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import {
  INDG_DEFAULT_ALLOWED_SCORES,
  INDG_DEFAULT_REASON_CODES,
  INDG_DEFAULT_SYSTEM_PROMPT,
  Role,
} from '@koh/common';
import { EmbeddableQuestionModel } from '../src/lti/embeddable/question/embeddable-question.entity';
import { EmbeddableQuestionFeedbackModel } from '../src/lti/embeddable/question/embeddable-question-feedback.entity';
import { EmbeddableGradingProfileModel } from '../src/lti/embeddable/question/grading-profile.entity';

describe('Embeddable Question Integration', () => {
  const mockChatbotApiService = {
    queryChatbotForCourse: jest.fn(),
  };

  const { supertest } = setupIntegrationTest(LtiModule, (builder) =>
    builder
      .overrideProvider(ChatbotApiService)
      .useValue(mockChatbotApiService),
  );

  beforeEach(() => {
    mockChatbotApiService.queryChatbotForCourse.mockReset();
  });

  const setupCourseMember = async (role: Role) => {
    const user = await UserFactory.create();
    const course = await CourseFactory.create();
    await UserCourseFactory.create({ user, course, role });
    return { user, course };
  };

  const createQuestion = async (courseId: number) =>
    EmbeddableQuestionModel.create({
      courseId,
      name: 'Reflection 1',
      questionText: 'Reflect on Indigenous culture.',
      criteriaText: 'Hidden grading criteria.',
      instructions: 'Hidden grading instructions.',
      minSentences: 3,
      maxSentences: 5,
    }).save();

  const createProfile = async (courseId: number) =>
    EmbeddableGradingProfileModel.create({
      courseId,
      policyKind: 'indg-reflection',
      systemPrompt: INDG_DEFAULT_SYSTEM_PROMPT,
      allowedScores: [...INDG_DEFAULT_ALLOWED_SCORES],
      reasonCodes: [...INDG_DEFAULT_REASON_CODES],
    }).save();

  it('returns only student-safe question fields to an enrolled student', async () => {
    const { user: student, course } = await setupCourseMember(Role.STUDENT);
    const question = await createQuestion(course.id);

    const res = await supertest({ userId: student.id })
      .get(`/lti/embeddable-question/${course.id}/${question.id}`)
      .expect(200);

    expect(res.body).toEqual({
      id: question.id,
      courseId: course.id,
      questionText: question.questionText,
      minSentences: 3,
      maxSentences: 5,
    });
    expect(res.body).not.toHaveProperty('criteriaText');
    expect(res.body).not.toHaveProperty('instructions');
  });

  it('keeps full criteria available on the staff-only management route', async () => {
    const { user: professor, course } = await setupCourseMember(Role.PROFESSOR);
    const question = await createQuestion(course.id);

    const res = await supertest({ userId: professor.id })
      .get(`/lti/embeddable-question/${course.id}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual(
      expect.objectContaining({
        id: question.id,
        criteriaText: 'Hidden grading criteria.',
      }),
    );
  });

  it('rejects a user who is not enrolled in the course', async () => {
    const outsider = await UserFactory.create();
    const course = await CourseFactory.create();
    const question = await createQuestion(course.id);

    await supertest({ userId: outsider.id })
      .get(`/lti/embeddable-question/${course.id}/${question.id}`)
      .expect(404);
  });

  it('rejects a cross-course question before asking the grading model', async () => {
    const { user: student, course } = await setupCourseMember(Role.STUDENT);
    const otherCourse = await CourseFactory.create();
    const otherQuestion = await createQuestion(otherCourse.id);

    await supertest({ userId: student.id })
      .post(
        `/lti/embeddable-question/${course.id}/${otherQuestion.id}/feedback`,
      )
      .send({ responseText: 'Sentence one. Sentence two. Sentence three.' })
      .expect(404);

    expect(mockChatbotApiService.queryChatbotForCourse).not.toHaveBeenCalled();
  });

  it('stores feedback against the authenticated HelpMe user', async () => {
    const { user: student, course } = await setupCourseMember(Role.STUDENT);
    const question = await createQuestion(course.id);
    await createProfile(course.id);
    mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
      answer: {
        score: 2,
        comment: 'The reflection meets the requirements.',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      },
      model: 'grading-model',
    });

    const submission =
      'First sentence on Indigenous history. Second sentence on culture. Third sentence reflecting on learning.';

    const res = await supertest({ userId: student.id })
      .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
      .send({ responseText: submission })
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        score: 2,
        maxScore: 2,
        comment: 'The reflection meets the requirements.',
      }),
    );

    const saved = await EmbeddableQuestionFeedbackModel.findOne({
      where: { questionId: question.id, userId: student.id },
    });
    expect(saved).toEqual(
      expect.objectContaining({
        courseId: course.id,
        questionId: question.id,
        userId: student.id,
        submission,
        aiModel: 'grading-model',
      }),
    );
  });
});
