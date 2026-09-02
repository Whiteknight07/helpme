import { setupIntegrationTest } from './util/testUtils';
import { LtiModule } from '../src/lti/lti.module';
import { ChatbotApiService } from '../src/chatbot/chatbot-api.service';
import {
  CourseFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import { Role } from '@koh/common';
import { EmbeddableQuestionModel } from '../src/lti/embeddable/question/embeddable-question.entity';
import { EmbeddableQuestionFeedbackModel } from '../src/lti/embeddable/question/embeddable-question-feedback.entity';

describe('Embeddable Question Integration', () => {
  const mockChatbotApiService = {
    queryChatbotForCourse: jest.fn(),
  };

  const { supertest } = setupIntegrationTest(LtiModule, (builder) =>
    builder.overrideProvider(ChatbotApiService).useValue(mockChatbotApiService),
  );

  beforeEach(async () => {
    mockChatbotApiService.queryChatbotForCourse.mockReset();
  });

  describe('Question Configuration & Permissions', () => {
    it('allows professor to create a question', async () => {
      const professor = await UserFactory.create();
      const course = await CourseFactory.create();
      await UserCourseFactory.create({
        user: professor,
        course,
        role: Role.PROFESSOR,
      });

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

    it('rejects student from creating a question', async () => {
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
      await UserCourseFactory.create({
        user: student,
        course,
        role: Role.STUDENT,
      });

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
      const student = await UserFactory.create();
      const course1 = await CourseFactory.create();
      const course2 = await CourseFactory.create();

      await UserCourseFactory.create({
        user: student,
        course: course1,
        role: Role.STUDENT,
      });

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
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
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
        minSentences: 3,
        maxSentences: 5,
      }).save();

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
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
      await UserCourseFactory.create({
        user: student,
        course,
        role: Role.STUDENT,
      });

      const question = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q1',
        questionText: 'Reflect on Indigenous culture.',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue(
        JSON.stringify({
          score: 2,
          comment: 'The reflection is thoughtful and meets requirements.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        }),
      );

      const draft =
        'First sentence on Indigenous history. Second sentence discussing culture. Third sentence reflecting on learnings.';

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(res.body.feedback).toBe(
        'The reflection is thoughtful and meets requirements.',
      );
      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        1,
      );

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: question.id, userId: student.id },
      });
      expect(saved).not.toBeNull();
      expect(saved!.aiGrade).toBe(2);
      expect(saved!.courseId).toBe(course.id);
      expect(saved!.reasons).toEqual(['meets_requirements']);
      expect(saved!.needsHumanReview).toBe(false);
    });

    it('caps score at 1 and prepends fixed sentence comment when draft is too short', async () => {
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
      await UserCourseFactory.create({
        user: student,
        course,
        role: Role.STUDENT,
      });

      const question = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Q1',
        questionText: 'Reflect on Indigenous culture.',
        criteriaText: 'Criteria',
        minSentences: 3,
        maxSentences: 5,
      }).save();

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue(
        JSON.stringify({
          score: 2,
          comment: 'Good points raised.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        }),
      );

      const draft = 'Only one short sentence.';

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(res.body.feedback).toContain(
        'This answer does not meet the sentence requirements noted in the question.',
      );
      expect(res.body.feedback).toContain('Good points raised.');

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: question.id, userId: student.id },
      });
      expect(saved!.aiGrade).toBe(1);
      expect(saved!.reasons).toContain('too_short');
    });

    it('retries once on invalid model output and fails without saving if retry is also invalid', async () => {
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
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
        minSentences: 3,
        maxSentences: 5,
      }).save();

      mockChatbotApiService.queryChatbotForCourse
        .mockResolvedValueOnce('Invalid non-json output')
        .mockResolvedValueOnce('Still invalid output after repair prompt');

      const draft = 'Sentence one. Sentence two. Sentence three.';

      await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(500);

      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        2,
      );

      const savedCount = await EmbeddableQuestionFeedbackModel.count();
      expect(savedCount).toBe(0);
    });

    it('retries once on invalid model output and succeeds and saves if retry is valid', async () => {
      const student = await UserFactory.create();
      const course = await CourseFactory.create();
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
        minSentences: 3,
        maxSentences: 5,
      }).save();

      mockChatbotApiService.queryChatbotForCourse
        .mockResolvedValueOnce('Malformed first response')
        .mockResolvedValueOnce(
          JSON.stringify({
            score: 2,
            comment: 'Valid response after repair.',
            reasons: ['meets_requirements'],
            needs_human_review: false,
          }),
        );

      const draft = 'Sentence one. Sentence two. Sentence three.';

      const res = await supertest({ userId: student.id })
        .post(`/lti/embeddable-question/${course.id}/${question.id}/feedback`)
        .send({ responseText: draft })
        .expect(201);

      expect(res.body.feedback).toBe('Valid response after repair.');
      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        2,
      );

      const saved = await EmbeddableQuestionFeedbackModel.findOne({
        where: { questionId: question.id, userId: student.id },
      });
      expect(saved).not.toBeNull();
      expect(saved!.aiFeedback).toBe('Valid response after repair.');
      expect(saved!.aiGrade).toBe(2);
    });
  });
});
