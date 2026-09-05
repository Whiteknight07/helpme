import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ERROR_MESSAGES,
  LMSIntegrationPlatform,
  Role,
  UpsertLMSCourseParams,
} from '@koh/common';
import { Request } from 'express';
import { getAppAuthUserId } from '../login/auth-token';
import { UserCourseModel } from '../profile/user-course.entity';
import { OrganizationCourseModel } from '../organization/organization-course.entity';
import { LMSOrganizationIntegrationModel } from '../lmsIntegration/lmsOrgIntegration.entity';
import { LMSCourseIntegrationModel } from '../lmsIntegration/lmsCourseIntegration.entity';

@Controller('lms')
export class LtiCourseLinkController {
  private readonly requireHttpsOrigin: boolean;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.requireHttpsOrigin =
      new URL(configService.getOrThrow<string>('DOMAIN')).protocol === 'https:';
  }

  @Post('course/:courseId/link')
  async linkCourseFromLti(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() props: UpsertLMSCourseParams,
    @Req() req: Request,
  ): Promise<string> {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (
      typeof origin !== 'string' ||
      origin === 'null' ||
      typeof host !== 'string'
    ) {
      throw new ForbiddenException();
    }

    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new ForbiddenException();
    }
    if (
      originUrl.host !== host ||
      (this.requireHttpsOrigin && originUrl.protocol !== 'https:')
    ) {
      throw new ForbiddenException();
    }

    const signedToken = req.cookies?.['lti_auth_token'];
    if (typeof signedToken !== 'string' || signedToken.length === 0) {
      throw new UnauthorizedException();
    }

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync(signedToken);
    } catch {
      throw new UnauthorizedException();
    }

    const userId = getAppAuthUserId(payload);
    const custom = (payload as {
      custom?: {
        ltiApiCourseId?: unknown;
        ltiPlatform?: unknown;
      };
    }).custom;
    const apiCourseId = custom?.ltiApiCourseId;
    const platform = custom?.ltiPlatform;

    if (
      typeof apiCourseId !== 'string' ||
      apiCourseId.length === 0 ||
      platform !== LMSIntegrationPlatform.Canvas
    ) {
      throw new ForbiddenException(
        'A verified Canvas LTI launch is required to link this course',
      );
    }
    if (props.apiPlatform !== platform || props.apiCourseId !== apiCourseId) {
      throw new ForbiddenException(
        'The requested course link does not match the current Canvas launch',
      );
    }

    const enrollment = await UserCourseModel.findOne({
      where: { userId, courseId },
    });
    if (!enrollment || enrollment.role !== Role.PROFESSOR) {
      throw new ForbiddenException();
    }

    const orgCourse = await OrganizationCourseModel.findOne({
      where: { courseId },
    });
    if (!orgCourse) {
      throw new NotFoundException(
        ERROR_MESSAGES.lmsController.organizationCourseNotFound,
      );
    }

    const orgIntegration = await LMSOrganizationIntegrationModel.findOne({
      where: {
        organizationId: orgCourse.organizationId,
        apiPlatform: platform,
      },
    });
    if (!orgIntegration) {
      throw new NotFoundException(
        ERROR_MESSAGES.lmsController.orgLmsIntegrationNotFound,
      );
    }

    if (await LMSCourseIntegrationModel.findOne({ where: { courseId } })) {
      throw new BadRequestException(
        ERROR_MESSAGES.lmsController.apiCourseIdInUse,
      );
    }
    if (
      await LMSCourseIntegrationModel.findOne({
        where: { apiCourseId },
      })
    ) {
      throw new BadRequestException(
        ERROR_MESSAGES.lmsController.apiCourseIdInUse,
      );
    }

    await LMSCourseIntegrationModel.create({
      courseId,
      apiCourseId,
      orgIntegration,
    }).save();

    return `Successfully linked ${platform} course ${apiCourseId}`;
  }
}
