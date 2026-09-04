import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  EmbeddableQuestionFeedback,
  EmbeddableQuestionFeedbackParams,
} from '@koh/common';
import { EmbeddableQuestionService } from '../question/embeddable-question.service';
import { EmbeddableQuestionModel } from '../question/embeddable-question.entity';
import { EmbeddableResourceGuard } from './embeddable-resource.guard';
import { EmbeddableResourceRequest } from './embeddable-resource-auth';

@Controller('lti/embeddable-resource')
@UseGuards(EmbeddableResourceGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class EmbeddableResourceController {
  constructor(
    private readonly embeddableQuestionService: EmbeddableQuestionService,
  ) {}

  @Get(':courseId/:questionId')
  async findOne(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ): Promise<EmbeddableQuestionModel> {
    return this.embeddableQuestionService.findOne(courseId, questionId);
  }

  @Post(':courseId/:questionId/feedback')
  async getFeedback(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: EmbeddableQuestionFeedbackParams,
    @Req() req: EmbeddableResourceRequest,
  ): Promise<EmbeddableQuestionFeedback> {
    const auth = req.resourceAuth;
    const feedback = await this.embeddableQuestionService.getFeedback(
      body.responseText,
      questionId,
      courseId,
      auth.role === 'staff'
        ? {
            kind: 'lti',
            ltiIssuer: auth.iss,
            ltiSubject: auth.sub,
            userId: auth.userId,
          }
        : { kind: 'lti', ltiIssuer: auth.iss, ltiSubject: auth.sub },
    );
    const profile = await this.embeddableQuestionService.getProfile(courseId);

    return {
      score: feedback.aiGrade,
      comment: feedback.aiFeedback,
      reasons: feedback.reasons,
      needsHumanReview: feedback.needsHumanReview,
      maxScore: Math.max(...profile.allowedScores),
    };
  }
}
