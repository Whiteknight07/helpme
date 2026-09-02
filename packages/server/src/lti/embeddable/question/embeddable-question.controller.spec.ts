import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddableQuestionController } from './embeddable-question.controller';
import { EmbeddableQuestionService } from './embeddable-question.service';
import { BadRequestException } from '@nestjs/common';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { EmbeddableQuestionFeedbackModel } from './embeddable-question-feedback.entity';

describe('EmbeddableQuestionController', () => {
  let controller: EmbeddableQuestionController;
  let mockService: Partial<Record<keyof EmbeddableQuestionService, jest.Mock>>;

  beforeEach(async () => {
    mockService = {
      findAllForCourse: jest.fn(),
      findOne: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      getFeedback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmbeddableQuestionController],
      providers: [
        {
          provide: EmbeddableQuestionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<EmbeddableQuestionController>(
      EmbeddableQuestionController,
    );
  });

  describe('findAll', () => {
    it('returns all questions for course', async () => {
      const mockQuestions = [
        { id: 1, name: 'Q1' },
      ] as EmbeddableQuestionModel[];
      mockService.findAllForCourse!.mockResolvedValue(mockQuestions);

      const result = await controller.findAll(10);
      expect(mockService.findAllForCourse).toHaveBeenCalledWith(10);
      expect(result).toBe(mockQuestions);
    });
  });

  describe('findOne', () => {
    it('returns question by courseId and questionId', async () => {
      const mockQuestion = { id: 1, name: 'Q1' } as EmbeddableQuestionModel;
      mockService.findOne!.mockResolvedValue(mockQuestion);

      const result = await controller.findOne(10, 1);
      expect(mockService.findOne).toHaveBeenCalledWith(10, 1);
      expect(result).toBe(mockQuestion);
    });
  });

  describe('create', () => {
    it('creates new question', async () => {
      const body = {
        name: 'Reflection 1',
        questionText: 'What did you learn?',
        criteriaText: 'Clear reflection.',
        minSentences: 3,
        maxSentences: 5,
      };
      const mockQuestion = { id: 1, ...body } as EmbeddableQuestionModel;
      mockService.upsert!.mockResolvedValue(mockQuestion);

      const result = await controller.create(10, body);
      expect(mockService.upsert).toHaveBeenCalledWith(10, body);
      expect(result).toBe(mockQuestion);
    });
  });

  describe('update', () => {
    it('updates existing question', async () => {
      const body = {
        questionText: 'Updated question text',
        criteriaText: 'Updated criteria',
      };
      const mockQuestion = {
        id: 1,
        courseId: 10,
        ...body,
      } as EmbeddableQuestionModel;
      mockService.upsert!.mockResolvedValue(mockQuestion);

      const result = await controller.update(10, 1, body);
      expect(mockService.upsert).toHaveBeenCalledWith(10, body, 1);
      expect(result).toBe(mockQuestion);
    });
  });

  describe('delete', () => {
    it('deletes question', async () => {
      mockService.delete!.mockResolvedValue(undefined);

      await controller.delete(10, 1);
      expect(mockService.delete).toHaveBeenCalledWith(10, 1);
    });
  });

  describe('getFeedback', () => {
    it('throws BadRequestException if responseText is empty or whitespace', async () => {
      await expect(
        controller.getFeedback(10, 1, { responseText: '   ' }, 100),
      ).rejects.toThrow(BadRequestException);
      expect(mockService.getFeedback).not.toHaveBeenCalled();
    });

    it('submits responseText and returns feedback comment and score', async () => {
      const mockFeedback = {
        id: 50,
        aiFeedback: 'Good response.',
        aiGrade: 2,
      } as EmbeddableQuestionFeedbackModel;
      mockService.getFeedback!.mockResolvedValue(mockFeedback);

      const result = await controller.getFeedback(
        10,
        1,
        { responseText: 'My draft submission text.' },
        100,
      );

      expect(mockService.getFeedback).toHaveBeenCalledWith(
        'My draft submission text.',
        1,
        10,
        100,
      );
      expect(result).toEqual({
        feedback: 'Good response.',
        grade: 2,
      });
    });
  });
});
