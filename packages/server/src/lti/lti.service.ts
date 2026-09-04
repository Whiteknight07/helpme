import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserCourseModel } from '../profile/user-course.entity';
import { UserModel } from '../profile/user.entity';
import {
  IdToken,
  LtiResourceLinkContentItem,
  Provider,
} from '@bhunt02/lti-typescript';
import { LMSCourseIntegrationModel } from '../lmsIntegration/lmsCourseIntegration.entity';
import { ERROR_MESSAGES, isProd, OrganizationRole, Role } from '@koh/common';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions } from 'express';
import { LtiCourseInviteModel } from './lti-course-invite.entity';
import * as crypto from 'crypto';
import { UserLtiIdentityModel } from './user_lti_identity.entity';
import { LtiIdentityTokenModel } from './lti_identity_token.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LMSAuthStateModel } from '../lmsIntegration/lms-auth-state.entity';
import { pick } from 'lodash';
import { Not } from 'typeorm';
import { EmbeddableQuestionModel } from './embeddable/question/embeddable-question.entity';
import { EmbeddableQuestionService } from './embeddable/question/embeddable-question.service';
import { OrganizationUserModel } from '../organization/organization-user.entity';
import { OrganizationCourseModel } from '../organization/organization-course.entity';

export const HELPME_QUESTION_ID_PARAM = 'helpme_question_id';
export const LTI_MEMBERSHIP_LEARNER_ROLE =
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner';
const LTI_MEMBERSHIP_STAFF_ROLES = [
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant',
];

@Injectable()
export class LtiService {
  static readonly cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? 'none' : 'lax',
  };
  constructor(
    private jwtService: JwtService,
    private embeddableQuestionService: EmbeddableQuestionService,
  ) {}

  private _provider: Provider | undefined;
  get provider(): Provider {
    if (!this._provider) {
      throw new Error('LTI Provider not initialized!');
    }
    return this._provider;
  }
  set provider(provider: Provider) {
    this._provider = provider;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'CLEAR_LTI_TOKENS' })
  async clearLtiTokens() {
    await LMSAuthStateModel.createQueryBuilder()
      .delete()
      .where(
        `(EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM lti_identity_token_model."createdAt")) > lti_identity_token_model."expiresIn"`,
      )
      .execute();
    await LMSAuthStateModel.createQueryBuilder()
      .delete()
      .where(
        `(EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM lti_course_invite_model."createdAt")) > lti_course_invite_model."expiresIn"`,
      )
      .execute();
  }

  async createLtiIdentityToken(
    issuer: string,
    ltiUserId: string,
    ltiEmail?: string,
  ): Promise<string> {
    let code: string;
    do {
      code = crypto.randomBytes(64).toString('hex');
    } while (await LtiIdentityTokenModel.findOne({ where: { code } }));

    await LtiIdentityTokenModel.delete({
      issuer,
      ltiUserId,
    });

    await LtiIdentityTokenModel.create({
      code,
      issuer,
      ltiUserId,
      ltiEmail,
    }).save();

    const token = this.jwtService.sign({
      code,
    });

    if (!token) {
      throw new BadRequestException(ERROR_MESSAGES.ltiService.errorSigningJwt);
    }

    return token;
  }

  async checkLtiIdentityToken(
    userId: number,
    signedToken: string,
  ): Promise<boolean> {
    const token = this.jwtService.decode<{
      code: string;
    }>(signedToken);

    if (!token || !token.code) {
      throw new BadRequestException(
        ERROR_MESSAGES.ltiService.invalidIdentityJwt,
      );
    }

    const { code } = token;

    const matchingToken = await LtiIdentityTokenModel.findOne({
      where: {
        code,
      },
    });

    if (!matchingToken) {
      return false;
    }

    if (
      matchingToken.expiresInSeconds != undefined &&
      (Date.now() - matchingToken.createdAt.getTime()) / 1000 >=
        matchingToken.expiresInSeconds
    ) {
      await matchingToken.remove();
      return false;
    }

    // If user has logged in with a different account prior, remove the identity entry for that account for
    // this ISS + user ID combo
    await UserLtiIdentityModel.delete({
      userId: Not(userId),
      issuer: matchingToken.issuer,
      ltiUserId: matchingToken.ltiUserId,
    });

    await UserLtiIdentityModel.create({
      userId,
      ...pick(matchingToken, ['issuer', 'ltiEmail', 'ltiUserId']),
    }).save();

    // The matching token is not removed as it may be re-used later
    // await matchingToken.remove();

    return true;
  }

  async createCourseInvite(courseId: number, email: string): Promise<string> {
    let inviteCode: string;
    do {
      inviteCode = crypto.randomBytes(64).toString('hex');
    } while (
      await LtiCourseInviteModel.findOne({ where: { inviteCode, courseId } })
    );

    await LtiCourseInviteModel.create({
      courseId,
      inviteCode,
      email,
    }).save();

    const token = this.jwtService.sign({
      courseId,
      inviteCode,
    });

    if (!token) {
      throw new BadRequestException(ERROR_MESSAGES.ltiService.errorSigningJwt);
    }

    return token;
  }

  async checkCourseInvite(userId: number, code: string) {
    const token = this.jwtService.decode<{
      courseId: number;
      inviteCode: string;
    }>(code);

    if (
      !token ||
      !token.courseId ||
      isNaN(token.courseId) ||
      !token.inviteCode
    ) {
      throw new BadRequestException(ERROR_MESSAGES.ltiService.invalidInviteJwt);
    }

    const { courseId, inviteCode } = token;

    const user = await UserModel.findOne({
      where: {
        id: userId,
      },
      relations: {
        organizationUser: true,
      },
    });

    const matchingInvite = await LtiCourseInviteModel.findOne({
      where: {
        inviteCode,
        courseId,
      },
      relations: {
        course: {
          organizationCourse: true,
        },
      },
    });

    if (!matchingInvite) {
      throw new NotFoundException(
        ERROR_MESSAGES.ltiService.courseInviteNotFound,
      );
    }

    if (matchingInvite.email != user.email) {
      throw new BadRequestException(
        ERROR_MESSAGES.ltiService.courseInviteEmailMismatch,
      );
    }

    if (
      user.organizationUser.organizationId !=
      matchingInvite.course.organizationCourse.organizationId
    ) {
      throw new NotFoundException(
        ERROR_MESSAGES.ltiService.courseInviteOrganizationMismatch,
      );
    }

    if (
      matchingInvite.expiresInSeconds != undefined &&
      (Date.now() - matchingInvite.createdAt.getTime()) / 1000 >=
        matchingInvite.expiresInSeconds
    ) {
      await matchingInvite.remove();
      throw new BadRequestException(
        ERROR_MESSAGES.ltiService.courseInviteExpired,
      );
    }

    const enrollment = await UserCourseModel.findOne({
      where: {
        userId,
        courseId: courseId,
      },
    });

    // Delete any invites for this course for this email
    await LtiCourseInviteModel.delete({
      email: user.email,
      courseId,
    });

    if (!enrollment) {
      await UserCourseModel.create({
        userId,
        courseId: courseId,
        role: Role.STUDENT,
      }).save();
    }

    return courseId;
  }

  static async findMatchingUserAndCourse(
    token: IdToken,
  ): Promise<{ userId?: number; courseId?: number }> {
    let userId: number | undefined;
    let courseId: number | undefined = undefined;

    const matchingUserIds: number[] = (
      await UserModel.createQueryBuilder('user_model')
        .select('user_model.id', 'userId')
        .leftJoin(
          UserLtiIdentityModel,
          'lti_user',
          'lti_user."userId" = user_model.id AND lti_user.issuer = :issuer AND lti_user."ltiUserId" = :ltiUserId',
          {
            issuer: token.iss,
            ltiUserId: token.user,
          },
        )
        .addSelect('lti_user.issuer', 'ltiIssuer')
        .addSelect('lti_user."ltiUserId"', 'ltiUserId')
        .where('email = :email', {
          email: token.userInfo.email,
        })
        .orWhere('lti_user."userId" IS NOT NULL')
        .orderBy('lti_user."userId"', 'ASC', 'NULLS LAST')
        .getRawMany<{ userId: number }>()
    ).map(({ userId }) => userId);
    userId = matchingUserIds[0];

    let lmsCourseIntegration: LMSCourseIntegrationModel;

    const platformCourseId = LtiService.extractCourseId(token);
    if (platformCourseId != undefined) {
      lmsCourseIntegration = await LMSCourseIntegrationModel.findOne({
        where: {
          apiCourseId: platformCourseId,
        },
      });
      courseId = lmsCourseIntegration?.courseId;
    }

    // We only need to narrow it down if there's > 1
    if (matchingUserIds.length > 1 && courseId != undefined) {
      for (const matchingUserId of matchingUserIds) {
        const userCourse = await UserCourseModel.findOne({
          where: {
            userId: matchingUserId,
            courseId,
          },
        });
        if (!userCourse) {
          continue;
        }
        userId = userCourse.userId;
        break;
      }
    }

    // Refresh identity in case it's changed and the user was found
    if (userId != undefined) {
      // If user has logged in with a different account prior, remove the identity entry for that account for
      // this ISS + user ID combo
      await UserLtiIdentityModel.delete({
        userId: Not(userId),
        issuer: token.iss,
        ltiUserId: token.user,
      });

      await UserLtiIdentityModel.create({
        userId,
        issuer: token.iss,
        ltiEmail: token.userInfo.email,
        ltiUserId: token.user,
      }).save();
    }

    return {
      userId,
      courseId,
    };
  }

  static extractCourseId(token: IdToken) {
    switch (token.platformInfo.product_family_code) {
      case 'canvas':
        return token.platformContext.custom?.canvas_course_id;
      default:
        return undefined;
    }
  }

  static hasQuestionLaunch(token: IdToken): boolean {
    return (
      token?.platformContext?.custom?.[HELPME_QUESTION_ID_PARAM] !== undefined
    );
  }

  static parseStrictQuestionId(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value > 0) {
        return value;
      }
    } else if (typeof value === 'string') {
      if (/^[1-9]\d*$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) {
          return parsed;
        }
      }
    }
    throw new BadRequestException(
      'Question ID must be a positive base-10 integer',
    );
  }

  async resolveQuestionLaunch(
    token: IdToken,
  ): Promise<{ userId: number; courseId: number; questionId: number }> {
    const roles = token.platformContext?.roles;
    const isLearner = roles?.includes(LTI_MEMBERSHIP_LEARNER_ROLE);
    const isStaff = roles?.some((role) =>
      LTI_MEMBERSHIP_STAFF_ROLES.includes(role),
    );
    if (!isLearner && !isStaff) {
      throw new UnauthorizedException(
        'LTI launch requires a standard Learner, Instructor, or TeachingAssistant role',
      );
    }

    const platformCourseId = LtiService.extractCourseId(token);
    if (typeof platformCourseId !== 'string' || !platformCourseId) {
      throw new BadRequestException(
        'Canvas course ID custom parameter is missing',
      );
    }

    const lmsIntegration = await LMSCourseIntegrationModel.findOne({
      where: {
        apiCourseId: platformCourseId,
      },
    });

    if (!lmsIntegration) {
      throw new NotFoundException(
        'Canvas course is not mapped to a HelpMe course',
      );
    }

    const courseId = lmsIntegration.courseId;

    const questionId = LtiService.parseStrictQuestionId(
      token.platformContext.custom?.[HELPME_QUESTION_ID_PARAM],
    );

    const question = await EmbeddableQuestionModel.findOne({
      where: {
        id: questionId,
        courseId,
      },
    });

    if (!question) {
      throw new NotFoundException(
        'Question not found in the mapped HelpMe course',
      );
    }

    if (!isLearner) {
      return {
        userId: await this.authorizeExistingStaff(token, courseId),
        courseId,
        questionId,
      };
    }

    const orgCourse = await OrganizationCourseModel.findOne({
      where: { courseId },
    });
    if (!orgCourse?.organizationId) {
      throw new NotFoundException(
        'Mapped HelpMe course does not belong to an organization',
      );
    }
    const organizationId = orgCourse.organizationId;

    const existingIdentity = await UserLtiIdentityModel.findOne({
      where: {
        issuer: token.iss,
        ltiUserId: token.user,
      },
      relations: { user: { organizationUser: true } },
    });
    let user = existingIdentity?.user;
    const assertedEmail = token.userInfo?.email?.trim();

    if (!user && assertedEmail) {
      const candidates = await UserModel.find({
        where: { email: assertedEmail },
        relations: { organizationUser: true },
      });
      if (
        candidates.length === 1 &&
        (!candidates[0].organizationUser ||
          candidates[0].organizationUser.organizationId === organizationId)
      ) {
        user = candidates[0];
      }
    }

    if (!user) {
      user = await UserModel.create({
        email:
          assertedEmail ??
          `lti-${crypto.createHash('sha256').update(`${token.iss}\0${token.user}`).digest('hex')}@invalid`,
        firstName: token.userInfo?.given_name ?? token.userInfo?.name,
        lastName: token.userInfo?.family_name,
        password: null,
        emailVerified: !!assertedEmail,
      }).save();
    }

    if (
      user.organizationUser &&
      user.organizationUser.organizationId !== organizationId
    ) {
      throw new UnauthorizedException(
        'LTI identity belongs to a different organization',
      );
    }
    if (!user.organizationUser) {
      await OrganizationUserModel.create({
        userId: user.id,
        organizationId,
        role: OrganizationRole.MEMBER,
      }).save();
    }

    await UserLtiIdentityModel.delete({
      userId: Not(user.id),
      issuer: token.iss,
      ltiUserId: token.user,
    });

    await UserLtiIdentityModel.create({
      userId: user.id,
      issuer: token.iss,
      ltiUserId: token.user,
      ltiEmail: assertedEmail,
    }).save();

    const existingEnrollment = await UserCourseModel.findOne({
      where: {
        userId: user.id,
        courseId,
      },
    });

    if (!existingEnrollment) {
      await UserCourseModel.create({
        userId: user.id,
        courseId,
        role: Role.STUDENT,
      }).save();
    }

    return {
      userId: user.id,
      courseId,
      questionId,
    };
  }

  private async authorizeExistingStaff(
    token: IdToken,
    courseId: number,
  ): Promise<number> {
    const identity = await UserLtiIdentityModel.findOne({
      where: {
        issuer: token.iss,
        ltiUserId: token.user,
      },
    });
    if (!identity) {
      throw new ForbiddenException(
        'No HelpMe account is linked to this Canvas user',
      );
    }

    const enrollment = await UserCourseModel.findOne({
      where: {
        userId: identity.userId,
        courseId,
      },
    });
    if (
      !enrollment ||
      (enrollment.role !== Role.PROFESSOR && enrollment.role !== Role.TA)
    ) {
      throw new ForbiddenException(
        'LTI instructor launch requires a Professor or TA enrollment in the mapped course',
      );
    }

    return identity.userId;
  }

  /**
   * Authorizes a verified Deep Linking launch for the question picker.
   * Instructors are never provisioned or elevated: the HelpMe user and the
   * Professor/TA enrollment must already exist.
   */
  async authorizeDeepLinking(
    token: IdToken,
  ): Promise<{ userId: number; courseId: number }> {
    if (token.platformContext?.messageType !== 'LtiDeepLinkingRequest') {
      throw new BadRequestException('Expected an LTI Deep Linking request');
    }

    if (!token.platformContext?.deepLinkingSettings?.deep_link_return_url) {
      throw new BadRequestException(
        'Deep Linking request is missing its return settings',
      );
    }

    if (token.platformInfo?.product_family_code !== 'canvas') {
      throw new BadRequestException(
        'Deep Linking is only supported for Canvas',
      );
    }

    const platform = await this.provider.getPlatform(token.iss, token.clientId);
    if (!platform || !platform.active) {
      throw new ForbiddenException('Canvas platform is not active');
    }

    const platformCourseId = LtiService.extractCourseId(token);
    if (typeof platformCourseId !== 'string' || platformCourseId.length === 0) {
      throw new BadRequestException(
        'Canvas course ID custom parameter is missing',
      );
    }

    const lmsIntegration = await LMSCourseIntegrationModel.findOne({
      where: {
        apiCourseId: platformCourseId,
      },
    });
    if (!lmsIntegration) {
      throw new NotFoundException(
        'Canvas course is not mapped to a HelpMe course',
      );
    }
    const courseId = lmsIntegration.courseId;

    const userId = await this.authorizeExistingStaff(token, courseId);

    return { userId, courseId };
  }

  /**
   * Lists the mapped course's existing embeddable questions for the picker.
   */
  async getDeepLinkingQuestions(
    token: IdToken,
  ): Promise<EmbeddableQuestionModel[]> {
    const { courseId } = await this.authorizeDeepLinking(token);
    return this.embeddableQuestionService.findAllForCourse(courseId);
  }

  /**
   * Returns the library-signed Deep Linking form carrying exactly one
   * `ltiResourceLink` that re-enters the ordinary question launch. The
   * question is reloaded under the trusted mapped course so cross-course ids
   * are rejected.
   */
  async createDeepLinkingResponse(
    token: IdToken,
    questionId: unknown,
  ): Promise<string> {
    const parsedQuestionId = LtiService.parseStrictQuestionId(questionId);

    const { courseId } = await this.authorizeDeepLinking(token);

    const launchUrl = token.platformContext?.targetLinkUri;
    if (typeof launchUrl !== 'string' || launchUrl.length === 0) {
      throw new BadRequestException(
        'Deep Linking launch is missing its target link URI',
      );
    }

    const question = await this.embeddableQuestionService.findOne(
      courseId,
      parsedQuestionId,
    );
    const item: LtiResourceLinkContentItem = {
      type: 'ltiResourceLink',
      title: question.name ?? `HelpMe Question ${question.id}`,
      url: launchUrl,
      custom: {
        [HELPME_QUESTION_ID_PARAM]: String(question.id),
      },
      // Sized for the existing feedback UI.
      iframe: { src: launchUrl, width: 800, height: 600 },
    };

    return this.provider.DeepLinkingService.createDeepLinkingForm(token, item, {
      message: 'HelpMe question linked',
    });
  }
}
