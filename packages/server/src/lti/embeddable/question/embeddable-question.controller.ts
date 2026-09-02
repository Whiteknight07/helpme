import {
  BadRequestException,
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
@UseInterceptors(ClassSerializerInterceptor)
export class EmbeddableQuestionController {
  constructor(
    private readonly embeddableQuestionService: EmbeddableQuestionService,
  ) {}

  /**
   * Lists all embeddable questions for a course. TA and Professor only.
   */
  @Get(':courseId')
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.TA, Role.PROFESSOR)
  async findAll(
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<EmbeddableQuestionModel[]> {
    return await this.embeddableQuestionService.findAllForCourse(courseId);
  }

  /**
   * Retrieves a single question. Accessible to all enrolled course members.
   */
  @Get(':courseId/:questionId')
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async findOne(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<EmbeddableQuestionModel> {
    return await this.embeddableQuestionService.findOne(courseId, questionId);
  }

  /**
   * Submits a draft answer for feedback. Accessible to all enrolled course members.
   */
  @Post(':courseId/:questionId/feedback')
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async getFeedback(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: EmbeddableQuestionFeedbackParams,
    @UserId() userId: number,
  ): Promise<IndigenousFeedback> {
    const responseText = body?.responseText?.trim();
    if (!responseText) {
      throw new BadRequestException('Input is required');
    }

    const feedback = await this.embeddableQuestionService.getFeedback(
      responseText,
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
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.TA, Role.PROFESSOR)
  async create(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return await this.embeddableQuestionService.upsert(courseId, body);
  }

  /**
   * Updates an embeddable question. TA and Professor only.
   */
  @Patch(':courseId/:questionId')
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.TA, Role.PROFESSOR)
  async update(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return await this.embeddableQuestionService.upsert(
      courseId,
      body,
      questionId,
    );
  }

  /**
   * Deletes an embeddable question. TA and Professor only.
   */
  @Delete(':courseId/:questionId')
  @UseGuards(JwtAuthGuard, CourseRolesGuard)
  @Roles(Role.TA, Role.PROFESSOR)
  async delete(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<void> {
    await this.embeddableQuestionService.delete(courseId, questionId);
  }
}
