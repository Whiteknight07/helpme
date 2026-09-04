import { setupIntegrationTest } from './util/testUtils';
import { LtiModule } from '../src/lti/lti.module';
import { ChatbotApiService } from '../src/chatbot/chatbot-api.service';
import { JwtService } from '@nestjs/jwt';
import {
  CourseFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import { Role } from '@koh/common';
import {
  INDG_DEFAULT_ALLOWED_SCORES,
  INDG_DEFAULT_REASON_CODES,
  INDG_DEFAULT_SYSTEM_PROMPT,
} from '@koh/common';
import { EmbeddableQuestionModel } from '../src/lti/embeddable/question/embeddable-question.entity';
import { EmbeddableQuestionFeedbackModel } from '../src/lti/embeddable/question/embeddable-question-feedback.entity';
import { EmbeddableGradingProfileModel } from '../src/lti/embeddable/question/grading-profile.entity';
import {
  EMBEDDABLE_RESOURCE_TTL_SECONDS,
  resourceCookieName,
} from '../src/lti/embeddable/resource/embeddable-resource-auth';

type QuestionOverrides = Partial<
  Pick<
    EmbeddableQuestionModel,
    'name' | 'questionText' | 'criteriaText' | 'minSentences' | 'maxSentences'
  >
>;

describe('Embeddable Question Integration', () => {
  const mockChatbotApiService = {
    queryChatbotForCourse: jest.fn(),
  };

  const { supertest, getTestModule } = setupIntegrationTest(
    LtiModule,
    (builder) =>
      builder
        .overrideProvider(ChatbotApiService)
        .useValue(mockChatbotApiService),
  );

  beforeEach(async () => {
    mockChatbotApiService.queryChatbotForCourse.mockReset();
  });

  const setupUserCourse = async (role: Role) => {
    const user = await UserFactory.create();
    const course = await CourseFactory.create();
    await UserCourseFactory.create({ user, course, role });
    return { user, course };
  };

  const ensureIndgProfile = async (courseId: number) =>
    EmbeddableGradingProfileModel.create({
      courseId,
      policyKind: 'indg-reflection',
      systemPrompt: INDG_DEFAULT_SYSTEM_PROMPT,
      allowedScores: [...INDG_DEFAULT_ALLOWED_SCORES],
      reasonCodes: [...INDG_DEFAULT_REASON_CODES],
    }).save();

  const setupStudentQuestion = async (overrides: QuestionOverrides = {}) => {
    const { user: student, course } = await setupUserCourse(Role.STUDENT);
    await ensureIndgProfile(course.id);
    const question = await EmbeddableQuestionModel.create({
      courseId: course.id,
      name: 'Q1',
      questionText: 'Question text',
      criteriaText: 'Criteria',
      minSentences: 3,
      maxSentences: 5,
      ...overrides,
    }).save();
    return { student, course, question };
  };

  describe('Question Configuration & Permissions', () => {
    it('allows professor to create a question', async () => {
      const { user: professor, course } = await setupUserCourse(Role.PROFESSOR);

      const body = {
        name: 'INDG Reflection 1',
        questionText: 'Reflect on the reading.',
        criteriaText: 'Clear and thoughtful reflection.',
        minSentences: 3,
        maxSentences: 5,
      };

      const res = await supertest({ userId: professor.id })
        .post(`/lti/embeddable-question/${course.id}`)
        .send(body)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('INDG Reflection 1');
      expect(res.body.minSentences).toBe(3);
      expect(res.body.maxSentences).toBe(5);
    });

    it('stores a blank rubric with no Indigenous rules for a generic question', async () => {
      const { user: professor, course } = await setupUserCourse(Role.PROFESSOR);

      const body = {
        name: 'Generic Reflection',
        questionText: 'Reflect on the reading.',
        minSentences: 3,
        maxSentences: 5,
      };

      const createRes = await supertest({ userId: professor.id })
        .post(`/lti/embeddable-question/${course.id}`)
        .send(body)
        .expect(201);

      const stored = await EmbeddableQuestionModel.findOne({
        where: { id: createRes.body.id },
      });
      expect(stored).not.toBeNull();
      expect(stored!.criteriaText).toBe('');
    });

    it('rejects student from creating a question', async () => {
      const { user: student, course } = await setupUserCourse(Role.STUDENT);

      const body = {
        name: 'Student Question',
        questionText: 'Trying to create question as student.',
        criteriaText: 'Criteria',
      };

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}`)
        .send(body)
        .expect(403);
    });
  });

  describe('Outsider & Cross-Course Protection', () => {
    it('rejects user not enrolled in the course', async () => {
      const outsider = await UserFactory.create();
      const course = await CourseFactory.create();
      const question = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q1',
        questionText: 'Question text',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();

      await supertest({ userId: outsider.id })
        .get(`/lti/embeddable-question/${course.id}/${question.id}`)
        .expect(404);
    });

    it('returns 404 when question ID belongs to a different course before calling model', async () => {
      const { user: student, course: course1 } = await setupUserCourse(
        Role.STUDENT,
      );
      const course2 = await CourseFactory.create();

      const questionInCourse2 = await EmbeddableQuestionModel.create({
        courseId: course2.id,
        name: 'Q in Course 2',
        questionText: 'Question in Course 2',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();

      await supertest({ userId: student.id })
        .post(
          `/lti/embeddable-question/${course1.id}/${questionInCourse2.id}/feedback`,
        )
        .send({ responseText: 'Draft answer for question in other course.' })
        .expect(404);

      expect(
        mockChatbotApiService.queryChatbotForCourse,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Deterministic Checks & Feedback Submission', () => {
    it('rejects blank or whitespace input without calling model or saving', async () => {
      const { student, course, question } = await setupStudentQuestion();

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: '   \n\t ' })
        .expect(400);

      expect(
        mockChatbotApiService.queryChatbotForCourse,
      ).not.toHaveBeenCalled();

      const savedCount = await EmbeddableQuestionFeedbackModel.count();
      expect(savedCount).toBe(0);
    });

    it('parses valid model response, saves attempt in DB, and returns comment', async () => {
      const { student, course, question } = await setupStudentQuestion({
        questionText: 'Reflect on Indigenous culture.',
      });

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
        answer: {
          score: 2,
          comment: 'The reflection is thoughtful and meets requirements.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        },
        model: 'gemini-1.5-flash-grading',
      });

      const draft =
        'First sentence on Indigenous history. Second sentence discussing culture. Third sentence reflecting on learnings.';

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        1,
      );

      expect(res.body.comment).toBe(
        'The reflection is thoughtful and meets requirements.',
      );
      expect(res.body.score).toBe(2);
      expect(res.body.maxScore).toBe(2);

      const savedCount = await EmbeddableQuestionFeedbackModel.count();
      expect(savedCount).toBe(1);

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: question.id, userId: student.id },
      });
      expect(saved).not.toBeNull();
      expect(saved!.userId).toBe(student.id);
      expect(saved!.courseId).toBe(course.id);
      expect(saved!.submission).toBe(draft);
      expect(saved!.aiModel).toBe('gemini-1.5-flash-grading');
    });

    it('caps score at 1 and prepends fixed sentence comment when draft is too short', async () => {
      const { student, course, question } = await setupStudentQuestion({
        questionText: 'Reflect on Indigenous culture.',
      });

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
        answer: {
          score: 2,
          comment: 'Good points raised.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        },
      });

      const draft = 'Only one short sentence.';

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(res.body.comment).toContain(
        'This answer does not meet the sentence requirements noted in the question.',
      );
      expect(res.body.comment).toContain('Good points raised.');
      expect(res.body.score).toBe(1);
      expect(res.body.reasons).toContain('too_short');
    });

    it('returns 500 and saves zero rows on invalid INDG payload', async () => {
      const { student, course, question } = await setupStudentQuestion();

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
        answer: {
          score: 3,
          comment: 'Unsupported score value.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        },
      });

      const draft = 'Sentence one. Sentence two. Sentence three.';

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(500);

      const savedCount = await EmbeddableQuestionFeedbackModel.count();
      expect(savedCount).toBe(0);
    });

    it('maps rejected chatbot call to 500 and saves zero rows', async () => {
      const { student, course, question } = await setupStudentQuestion();

      mockChatbotApiService.queryChatbotForCourse.mockRejectedValue(
        new Error('Chatbot service failure'),
      );

      const draft = 'Sentence one. Sentence two. Sentence three.';

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(500);

      const savedCount = await EmbeddableQuestionFeedbackModel.count();
      expect(savedCount).toBe(0);
    });
  });

  describe('Grading Profile', () => {
    it('leaves one profile row after concurrent first access', async () => {
      const { user: professor, course } = await setupUserCourse(Role.PROFESSOR);
      const agent = supertest({ userId: professor.id });

      const reads = await Promise.all(
        Array.from({ length: 5 }, () =>
          agent
            .get(`/lti/embeddable-question/${course.id}/grading-profile`)
            .expect(200),
        ),
      );

      expect(new Set(reads.map((res) => res.body.id)).size).toBe(1);
      expect(
        await EmbeddableGradingProfileModel.count({
          where: { courseId: course.id },
        }),
      ).toBe(1);
    });

    it('rejects students from reading or updating the profile', async () => {
      const { user: student, course } = await setupUserCourse(Role.STUDENT);

      await supertest({ userId: student.id })
        .get(`/lti/embeddable-question/${course.id}/grading-profile`)
        .expect(403);
      await supertest({ userId: student.id })
        .patch(`/lti/embeddable-question/${course.id}/grading-profile`)
        .send({
          policyKind: 'generic',
          systemPrompt: 'Student override attempt.',
          allowedScores: [0, 1],
          reasonCodes: ['meets_requirements'],
        })
        .expect(403);
    });

    it('rejects indg-reflection updates without the INDG scores and reasons', async () => {
      const { user: professor, course } = await setupUserCourse(Role.PROFESSOR);

      await supertest({ userId: professor.id })
        .patch(`/lti/embeddable-question/${course.id}/grading-profile`)
        .send({
          policyKind: 'indg-reflection',
          systemPrompt: 'Custom INDG prompt.',
          allowedScores: [0, 1, 2],
          reasonCodes: [...INDG_DEFAULT_REASON_CODES],
        })
        .expect(400);

      await supertest({ userId: professor.id })
        .patch(`/lti/embeddable-question/${course.id}/grading-profile`)
        .send({
          policyKind: 'indg-reflection',
          systemPrompt: 'Custom INDG prompt.',
          allowedScores: [...INDG_DEFAULT_ALLOWED_SCORES],
          reasonCodes: ['meets_requirements'],
        })
        .expect(400);
    });

    it('grades a generic-contract score once the profile allows it', async () => {
      const { user: professor, course } = await setupUserCourse(Role.PROFESSOR);
      const student = await UserFactory.create();
      await UserCourseFactory.create({
        user: student,
        course,
        role: Role.STUDENT,
      });
      const question = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q1',
        questionText: 'Question text',
        criteriaText: 'Criteria',
        minSentences: 1,
        maxSentences: 5,
      }).save();

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
        answer: {
          score: 3,
          comment: 'Excellent work.',
          reasons: ['needs_review'],
          needs_human_review: false,
        },
      });
      const draft = 'A complete answer meeting every criterion.';

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(500);

      await supertest({ userId: professor.id })
        .patch(`/lti/embeddable-question/${course.id}/grading-profile`)
        .send({
          policyKind: 'generic',
          systemPrompt: 'Grade against the criteria only.',
          allowedScores: [0, 1, 2, 3],
          reasonCodes: ['meets_requirements', 'needs_review'],
        })
        .expect(200);

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(res.body.score).toBe(3);
      expect(res.body.maxScore).toBe(3);
    });
  });

  describe('Embeddable Resource (Canvas launch cookie)', () => {
    const ISS = 'https://canvas.example.edu';
    const SUB = 'canvas-learner-9';

    const setupResourceQuiz = async () => {
      const course = await CourseFactory.create();
      await ensureIndgProfile(course.id);
      const q1 = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q1',
        questionText: 'Question one text',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();
      const q2 = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q2',
        questionText: 'Question two text',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();
      return { course, q1, q2 };
    };

    const signLearner = (
      courseId: number,
      questionId: number,
      ltiSubject = SUB,
    ): string => {
      const jwtService = getTestModule().get<JwtService>(JwtService);
      return jwtService.sign(
        {
          kind: 'embeddable-resource',
          role: 'learner',
          ltiIssuer: ISS,
          ltiSubject,
          courseId,
          questionId,
        },
        { expiresIn: EMBEDDABLE_RESOURCE_TTL_SECONDS },
      );
    };

    const mockValidFeedback = () => {
      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue({
        answer: {
          score: 2,
          comment: 'The reflection is thoughtful and meets requirements.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        },
        model: 'gemini-1.5-flash-grading',
      });
    };

    const draft =
      'First sentence on Indigenous history. Second sentence discussing culture. Third sentence reflecting on learnings.';

    it('serves two questions side by side with distinct cookies', async () => {
      const { course, q1, q2 } = await setupResourceQuiz();
      const c1 = `${resourceCookieName(course.id, q1.id)}=${signLearner(course.id, q1.id)}`;
      const c2 = `${resourceCookieName(course.id, q2.id)}=${signLearner(course.id, q2.id)}`;
      expect(c1.split('=')[0]).not.toBe(c2.split('=')[0]);

      await supertest()
        .get(`/lti/embeddable-resource/${course.id}/${q1.id}`)
        .set('Cookie', [c1, c2])
        .expect(200)
        .then((res) => {
          expect(res.body.id).toBe(q1.id);
        });

      await supertest()
        .get(`/lti/embeddable-resource/${course.id}/${q2.id}`)
        .set('Cookie', [c1, c2])
        .expect(200)
        .then((res) => {
          expect(res.body.id).toBe(q2.id);
        });
    });

    it('rejects a Q1 credential on Q2 question and feedback routes without calling the model', async () => {
      const { course, q1, q2 } = await setupResourceQuiz();
      const q1Token = signLearner(course.id, q1.id);
      const q2Name = resourceCookieName(course.id, q2.id);

      await supertest()
        .get(`/lti/embeddable-resource/${course.id}/${q2.id}`)
        .set('Cookie', [`${q2Name}=${q1Token}`])
        .expect(403);

      await supertest()
        .post(`/lti/embeddable-resource/${course.id}/${q2.id}/feedback`)
        .set('Cookie', [`${q2Name}=${q1Token}`])
        .send({ responseText: draft })
        .expect(403);

      expect(
        mockChatbotApiService.queryChatbotForCourse,
      ).not.toHaveBeenCalled();
      expect(await EmbeddableQuestionFeedbackModel.count()).toBe(0);
    });

    it.each([
      ['tampered', 'tampered'],
      ['expired', 'expired'],
      ['wrong-kind', 'wrong-kind'],
    ])(
      'rejects %s tokens before the chatbot on both routes',
      async (_, kind) => {
        const { course, q1 } = await setupResourceQuiz();
        const jwtService = getTestModule().get<JwtService>(JwtService);
        const name = resourceCookieName(course.id, q1.id);
        let token: string;
        if (kind === 'tampered') {
          const valid = signLearner(course.id, q1.id);
          token = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');
        } else if (kind === 'expired') {
          token = jwtService.sign({
            kind: 'embeddable-resource',
            role: 'learner',
            ltiIssuer: ISS,
            ltiSubject: SUB,
            courseId: course.id,
            questionId: q1.id,
            exp: Math.floor(Date.now() / 1000) - 10,
          });
        } else {
          token = jwtService.sign({ userId: 999999 });
        }

        await supertest()
          .get(`/lti/embeddable-resource/${course.id}/${q1.id}`)
          .set('Cookie', [`${name}=${token}`])
          .expect(401);

        await supertest()
          .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
          .set('Cookie', [`${name}=${token}`])
          .send({ responseText: draft })
          .expect(401);

        expect(
          mockChatbotApiService.queryChatbotForCourse,
        ).not.toHaveBeenCalled();
        expect(await EmbeddableQuestionFeedbackModel.count()).toBe(0);
      },
    );

    it.each([
      ['missing', undefined],
      ['foreign', 'https://evil.example'],
    ])(
      'rejects valid-token feedback POST with %s Origin without model call or row',
      async (_, origin) => {
        const { course, q1 } = await setupResourceQuiz();
        mockValidFeedback();
        const name = resourceCookieName(course.id, q1.id);
        const req = supertest()
          .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
          .set('Cookie', [`${name}=${signLearner(course.id, q1.id)}`])
          .set('Host', 'example.com');
        if (origin) req.set('Origin', origin);
        await req.send({ responseText: draft }).expect(403);
        expect(
          mockChatbotApiService.queryChatbotForCourse,
        ).not.toHaveBeenCalled();
        expect(await EmbeddableQuestionFeedbackModel.count()).toBe(0);
      },
    );

    it('persists LTI issuer and subject with a null userId', async () => {
      const { course, q1 } = await setupResourceQuiz();
      mockValidFeedback();
      const name = resourceCookieName(course.id, q1.id);

      await supertest()
        .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
        .set('Cookie', [`${name}=${signLearner(course.id, q1.id)}`])
        .set('Host', 'example.com')
        .set('Origin', 'https://example.com')
        .send({ responseText: draft })
        .expect(201);

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: q1.id },
      });
      expect(saved).not.toBeNull();
      expect(saved!.userId).toBeNull();
      expect(saved!.ltiIssuer).toBe(ISS);
      expect(saved!.ltiSubject).toBe(SUB);
      expect(saved!.courseId).toBe(course.id);
    });

    it('stores repeated valid submissions as repeated rows', async () => {
      const { course, q1 } = await setupResourceQuiz();
      mockValidFeedback();
      const name = resourceCookieName(course.id, q1.id);
      const cookie = `${name}=${signLearner(course.id, q1.id)}`;

      await supertest()
        .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
        .set('Cookie', [cookie])
        .set('Host', 'example.com')
        .set('Origin', 'https://example.com')
        .send({ responseText: draft })
        .expect(201);
      await supertest()
        .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
        .set('Cookie', [cookie])
        .set('Host', 'example.com')
        .set('Origin', 'https://example.com')
        .send({ responseText: draft })
        .expect(201);

      expect(
        await EmbeddableQuestionFeedbackModel.count({
          where: { questionId: q1.id },
        }),
      ).toBe(2);
    });

    it('persists staff userId alongside LTI identity for instructor previews', async () => {
      const { course, q1 } = await setupResourceQuiz();
      const staff = await UserFactory.create();
      await UserCourseFactory.create({
        user: staff,
        course,
        role: Role.PROFESSOR,
      });
      mockValidFeedback();
      const jwtService = getTestModule().get<JwtService>(JwtService);
      const token = jwtService.sign(
        {
          kind: 'embeddable-resource',
          role: 'staff',
          ltiIssuer: ISS,
          ltiSubject: 'staff-sub-1',
          courseId: course.id,
          questionId: q1.id,
          userId: staff.id,
        },
        { expiresIn: EMBEDDABLE_RESOURCE_TTL_SECONDS },
      );
      const name = resourceCookieName(course.id, q1.id);

      await supertest()
        .post(`/lti/embeddable-resource/${course.id}/${q1.id}/feedback`)
        .set('Cookie', [`${name}=${token}`])
        .set('Host', 'example.com')
        .set('Origin', 'https://example.com')
        .send({ responseText: draft })
        .expect(201);

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: q1.id },
      });
      expect(saved).not.toBeNull();
      expect(saved!.userId).toBe(staff.id);
      expect(saved!.ltiIssuer).toBe(ISS);
      expect(saved!.ltiSubject).toBe('staff-sub-1');
    });

    it('requires the scoped cookie even for enrolled HelpMe members', async () => {
      const { course, q1 } = await setupResourceQuiz();
      const { user: student } = await setupUserCourse(Role.STUDENT);
      await UserCourseFactory.create({
        user: student,
        course,
        role: Role.STUDENT,
      });

      await supertest({ userId: student.id })
        .get(`/lti/embeddable-resource/${course.id}/${q1.id}`)
        .expect(401);
    });
  });
});
