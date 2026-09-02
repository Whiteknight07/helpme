import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddableQuestionService } from './embeddable-question.service';
import { ChatbotApiService } from '../../../chatbot/chatbot-api.service';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { EmbeddableQuestionFeedbackModel } from './embeddable-question-feedback.entity';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

describe('EmbeddableQuestionService', () => {
  let service: EmbeddableQuestionService;
  let mockChatbotApiService: { queryChatbotForCourse: jest.Mock };

  beforeEach(async () => {
    mockChatbotApiService = {
      queryChatbotForCourse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddableQuestionService,
        {
          provide: ChatbotApiService,
          useValue: mockChatbotApiService,
        },
      ],
    }).compile();

    service = module.get<EmbeddableQuestionService>(EmbeddableQuestionService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getFeedback', () => {
    it('throws BadRequestException for blank or whitespace input without calling model or saving', async () => {
      const findSpy = jest.spyOn(EmbeddableQuestionModel, 'findOne');
      const saveSpy = jest.spyOn(
        EmbeddableQuestionFeedbackModel.prototype,
        'save',
      );

      await expect(service.getFeedback('   ', 1, 10, 100)).rejects.toThrow(
        BadRequestException,
      );

      expect(findSpy).not.toHaveBeenCalled();
      expect(
        mockChatbotApiService.queryChatbotForCourse,
      ).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when question is not found in course', async () => {
      jest.spyOn(EmbeddableQuestionModel, 'findOne').mockResolvedValue(null);
      const saveSpy = jest.spyOn(
        EmbeddableQuestionFeedbackModel.prototype,
        'save',
      );

      await expect(
        service.getFeedback('A valid draft answer.', 999, 10, 100),
      ).rejects.toThrow(NotFoundException);

      expect(
        mockChatbotApiService.queryChatbotForCourse,
      ).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('processes valid feedback on first attempt and saves to database', async () => {
      const mockQuestion = {
        id: 1,
        courseId: 10,
        questionText: 'Explain the concept.',
        criteriaText: 'Clear reflection.',
        minSentences: 3,
        maxSentences: 5,
        availableFrom: undefined,
        availableUntil: undefined,
        isWeak: false,
      } as unknown as EmbeddableQuestionModel;

      jest
        .spyOn(EmbeddableQuestionModel, 'findOne')
        .mockResolvedValue(mockQuestion);

      const mockModelOutput = JSON.stringify({
        score: 2,
        comment: 'Excellent response that meets all requirements.',
        reasons: ['meets_requirements'],
        needs_human_review: false,
      });

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue(
        mockModelOutput,
      );

      const mockSavedFeedback = {
        id: 42,
        courseId: 10,
        questionId: 1,
        userId: 100,
        submission:
          'First sentence here. Second sentence here. Third sentence here.',
        aiFeedback: 'Excellent response that meets all requirements.',
        aiGrade: 2,
        reasons: ['meets_requirements'],
        needsHumanReview: false,
      } as unknown as EmbeddableQuestionFeedbackModel;

      const createSpy = jest
        .spyOn(EmbeddableQuestionFeedbackModel, 'create')
        .mockReturnValue({
          ...mockSavedFeedback,
          save: jest.fn().mockResolvedValue(mockSavedFeedback),
        } as any);

      const result = await service.getFeedback(
        'First sentence here. Second sentence here. Third sentence here.',
        1,
        10,
        100,
      );

      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        1,
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: 10,
          questionId: 1,
          userId: 100,
          aiGrade: 2,
          reasons: ['meets_requirements'],
        }),
      );
      expect(result.aiGrade).toBe(2);
    });

    it('retries once if first response is invalid JSON, then succeeds and saves if retry is valid', async () => {
      const mockQuestion = {
        id: 1,
        courseId: 10,
        questionText: 'Explain the concept.',
        criteriaText: 'Clear reflection.',
        minSentences: 3,
        maxSentences: 5,
        isWeak: false,
      } as unknown as EmbeddableQuestionModel;

      jest
        .spyOn(EmbeddableQuestionModel, 'findOne')
        .mockResolvedValue(mockQuestion);

      mockChatbotApiService.queryChatbotForCourse
        .mockResolvedValueOnce('Invalid non-json output from chatbot')
        .mockResolvedValueOnce(
          JSON.stringify({
            score: 2,
            comment: 'Valid JSON after retry.',
            reasons: ['meets_requirements'],
            needs_human_review: false,
          }),
        );

      const mockSavedFeedback = {
        id: 43,
        courseId: 10,
        questionId: 1,
        userId: 100,
        submission:
          'First sentence here. Second sentence here. Third sentence here.',
        aiFeedback: 'Valid JSON after retry.',
        aiGrade: 2,
        reasons: ['meets_requirements'],
        needsHumanReview: false,
      } as unknown as EmbeddableQuestionFeedbackModel;

      jest.spyOn(EmbeddableQuestionFeedbackModel, 'create').mockReturnValue({
        ...mockSavedFeedback,
        save: jest.fn().mockResolvedValue(mockSavedFeedback),
      } as any);

      const result = await service.getFeedback(
        'First sentence here. Second sentence here. Third sentence here.',
        1,
        10,
        100,
      );

      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        2,
      );
      expect(result.aiFeedback).toBe('Valid JSON after retry.');
    });

    it('retries once if first response is invalid JSON, then throws and saves nothing if retry is also invalid', async () => {
      const mockQuestion = {
        id: 1,
        courseId: 10,
        questionText: 'Explain the concept.',
        criteriaText: 'Clear reflection.',
        minSentences: 3,
        maxSentences: 5,
        isWeak: false,
      } as unknown as EmbeddableQuestionModel;

      jest
        .spyOn(EmbeddableQuestionModel, 'findOne')
        .mockResolvedValue(mockQuestion);

      mockChatbotApiService.queryChatbotForCourse
        .mockResolvedValueOnce('First invalid response')
        .mockResolvedValueOnce('Second invalid response');

      const createSpy = jest.spyOn(EmbeddableQuestionFeedbackModel, 'create');

      await expect(
        service.getFeedback(
          'First sentence here. Second sentence here. Third sentence here.',
          1,
          10,
          100,
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockChatbotApiService.queryChatbotForCourse).toHaveBeenCalledTimes(
        2,
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('caps score at 1 and prepends canned sentence comment when draft is under minimum sentences', async () => {
      const mockQuestion = {
        id: 1,
        courseId: 10,
        questionText: 'Explain the concept.',
        criteriaText: 'Clear reflection.',
        minSentences: 3,
        maxSentences: 5,
        isWeak: false,
      } as unknown as EmbeddableQuestionModel;

      jest
        .spyOn(EmbeddableQuestionModel, 'findOne')
        .mockResolvedValue(mockQuestion);

      mockChatbotApiService.queryChatbotForCourse.mockResolvedValue(
        JSON.stringify({
          score: 2,
          comment: 'Good thought.',
          reasons: ['meets_requirements'],
          needs_human_review: false,
        }),
      );

      const mockSavedFeedback = {
        id: 44,
        courseId: 10,
        questionId: 1,
        userId: 100,
        submission: 'Only one sentence.',
        aiFeedback:
          'This answer does not meet the sentence requirements noted in the question.\n\nGood thought.',
        aiGrade: 1,
        reasons: ['too_short'],
        needsHumanReview: false,
      } as unknown as EmbeddableQuestionFeedbackModel;

      const createSpy = jest
        .spyOn(EmbeddableQuestionFeedbackModel, 'create')
        .mockReturnValue({
          ...mockSavedFeedback,
          save: jest.fn().mockResolvedValue(mockSavedFeedback),
        } as any);

      const result = await service.getFeedback(
        'Only one sentence.',
        1,
        10,
        100,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          aiGrade: 1,
          reasons: ['too_short'],
          aiFeedback: expect.stringContaining(
            'This answer does not meet the sentence requirements noted in the question.',
          ),
        }),
      );
      expect(result.aiGrade).toBe(1);
    });
  });
});
