import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { CourseRolesGuard } from '../../../guards/course-roles.guard';
import { Roles } from '../../../decorators/roles.decorator';
import {
  EmbeddableQuestionFeedbackParams,
  IndigenousFeedback,
  Role,
  UpsertEmbeddableQuestionParams,
} from '@koh/common';
import { EmbeddableQuestionService } from './embeddable-question.service';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { UserId } from '../../../decorators/user.decorator';

@Controller('lti/embeddable-question')
@UseGuards(JwtAuthGuard, CourseRolesGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class EmbeddableQuestionController {
  constructor(
    private readonly embeddableQuestionService: EmbeddableQuestionService,
  ) {}

  /**
   * Lists all embeddable questions for a course. TA and Professor only.
   */
  @Get(':courseId')
  @Roles(Role.TA, Role.PROFESSOR)
  async findAll(
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<EmbeddableQuestionModel[]> {
    return this.embeddableQuestionService.findAllForCourse(courseId);
  }

  /**
   * Retrieves a single question. Accessible to all enrolled course members.
   */
  @Get(':courseId/:questionId')
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async findOne(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.findOne(courseId, questionId);
  }

  /**
   * Submits a draft answer for feedback. Accessible to all enrolled course members.
   */
  @Post(':courseId/:questionId/feedback')
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async getFeedback(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: EmbeddableQuestionFeedbackParams,
    @UserId() userId: number,
  ): Promise<IndigenousFeedback> {
    const feedback = await this.embeddableQuestionService.getFeedback(
      body.responseText,
      questionId,
      courseId,
      userId,
    );

    return {
      score: feedback.aiGrade,
      comment: feedback.aiFeedback,
      reasons: feedback.reasons,
      needsHumanReview: feedback.needsHumanReview,
    };
  }

  /**
   * Creates a new embeddable question. TA and Professor only.
   */
  @Post(':courseId')
  @Roles(Role.TA, Role.PROFESSOR)
  async create(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.upsert(courseId, body);
  }

  /**
   * Updates an embeddable question. TA and Professor only.
   */
  @Patch(':courseId/:questionId')
  @Roles(Role.TA, Role.PROFESSOR)
  async update(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.upsert(courseId, body, questionId);
  }

  /**
   * Deletes an embeddable question. TA and Professor only.
   */
  @Delete(':courseId/:questionId')
  @Roles(Role.TA, Role.PROFESSOR)
  async delete(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<void> {
    return this.embeddableQuestionService.delete(courseId, questionId);
  }
}
