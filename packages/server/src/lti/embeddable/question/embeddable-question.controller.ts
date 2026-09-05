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
  EmbeddableQuestionFeedback,
  GradingProfile,
  Role,
  UpsertEmbeddableQuestionParams,
  UpsertGradingProfileParams,
} from '@koh/common';
import { EmbeddableQuestionService } from './embeddable-question.service';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { EmbeddableGradingProfileModel } from './grading-profile.entity';
import { UserId } from '../../../decorators/user.decorator';

type StudentEmbeddableQuestion = Pick<
  EmbeddableQuestionModel,
  'id' | 'courseId' | 'questionText' | 'minSentences' | 'maxSentences'
>;

@Controller('lti/embeddable-question')
@UseGuards(JwtAuthGuard, CourseRolesGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class EmbeddableQuestionController {
  constructor(
    private readonly embeddableQuestionService: EmbeddableQuestionService,
  ) {}

  @Get(':courseId/grading-profile')
  @Roles(Role.TA, Role.PROFESSOR)
  async getProfile(
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<EmbeddableGradingProfileModel> {
    return this.embeddableQuestionService.getProfile(courseId);
  }

  @Patch(':courseId/grading-profile')
  @Roles(Role.TA, Role.PROFESSOR)
  async updateProfile(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() body: UpsertGradingProfileParams,
  ): Promise<GradingProfile> {
    return this.embeddableQuestionService.updateProfile(courseId, body);
  }

  /**
   * Staff use the full list for question management, including criteria.
   */
  @Get(':courseId')
  @Roles(Role.TA, Role.PROFESSOR)
  async findAll(
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<EmbeddableQuestionModel[]> {
    return this.embeddableQuestionService.findAllForCourse(courseId);
  }

  /**
   * Course members can load the question, but grading criteria stay server-side.
   */
  @Get(':courseId/:questionId')
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async findOne(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<StudentEmbeddableQuestion> {
    const question = await this.embeddableQuestionService.findOne(
      courseId,
      questionId,
    );
    return {
      id: question.id,
      courseId: question.courseId,
      questionText: question.questionText,
      minSentences: question.minSentences,
      maxSentences: question.maxSentences,
    };
  }

  /**
   * Feedback is always attributed to the authenticated HelpMe user.
   */
  @Post(':courseId/:questionId/feedback')
  @Roles(Role.STUDENT, Role.TA, Role.PROFESSOR)
  async getFeedback(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: EmbeddableQuestionFeedbackParams,
    @UserId() userId: number,
  ): Promise<EmbeddableQuestionFeedback> {
    return this.embeddableQuestionService.getFeedback({
      submission: body.responseText,
      questionId,
      courseId,
      userId,
    });
  }

  @Post(':courseId')
  @Roles(Role.TA, Role.PROFESSOR)
  async create(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.upsert(courseId, body);
  }

  @Patch(':courseId/:questionId')
  @Roles(Role.TA, Role.PROFESSOR)
  async update(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: UpsertEmbeddableQuestionParams,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.upsert(courseId, body, questionId);
  }

  @Delete(':courseId/:questionId')
  @Roles(Role.TA, Role.PROFESSOR)
  async delete(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<void> {
    return this.embeddableQuestionService.delete(courseId, questionId);
  }
}
