import { DataSource, Not } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { TestConfigModule, TestTypeOrmModule } from '../../test/util/testUtils';
import { FactoryModule } from '../factory/factory.module';
import { FactoryService } from '../factory/factory.service';
import {
  CourseFactory,
  initFactoriesFromService,
  lmsCourseIntFactory,
  LtiCourseInviteFactory,
  LtiIdentityTokenFactory,
  OrganizationCourseFactory,
  OrganizationFactory,
  OrganizationUserFactory,
  UserCourseFactory,
  UserFactory,
  UserLtiIdentityFactory,
} from '../../test/util/factories';
import { LtiService } from './lti.service';
import { IdToken, Provider } from '@bhunt02/lti-typescript';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES, Role } from '@koh/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModel } from '../profile/user.entity';
import { CourseModel } from '../course/course.entity';
import { LtiCourseInviteModel } from './lti-course-invite.entity';
import { LtiIdentityTokenModel } from './lti_identity_token.entity';
import { UserLtiIdentityModel } from './user_lti_identity.entity';
import { EmbeddableQuestionModel } from './embeddable/question/embeddable-question.entity';
import { UserCourseModel } from '../profile/user-course.entity';

const idToken = {
  iss: 'http://canvas.docker/',
  clientId: 'clientid',
  deploymentId: 'deploymentid',
  platformId: 'platformid',
  platformContext: {
    custom: {
      canvas_course_id: '1',
    },
  },
  platformInfo: {
    product_family_code: 'canvas',
  },
  user: '1',
  userInfo: {
    email: 'testuser@example.com',
  },
};

type LaunchTokenOverrides = Partial<
  Omit<IdToken, 'platformContext' | 'platformInfo' | 'userInfo'>
> & {
  platformContext?: Partial<IdToken['platformContext']>;
  platformInfo?: Partial<IdToken['platformInfo']>;
  userInfo?: Partial<IdToken['userInfo']>;
};

describe('LtiService', () => {
  let service: LtiService;
  let dataSource: DataSource;
  let jwtService: JwtService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TestTypeOrmModule,
        TestConfigModule,
        FactoryModule,
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: async (configService: ConfigService) => ({
            secret: configService.get('JWT_SECRET'),
          }),
        }),
      ],
      providers: [LtiService],
    }).compile();

    service = module.get<LtiService>(LtiService);
    dataSource = module.get<DataSource>(DataSource);
    jwtService = module.get<JwtService>(JwtService);

    // Grab FactoriesService from Nest
    const factories = module.get<FactoryService>(FactoryService);
    // Initialize the named exports to point to the actual factories
    initFactoriesFromService(factories);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.synchronize(true);
  });

  it('allows LTI cookies over HTTP in development', () => {
    expect(LtiService.cookieOptions).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });

  describe('get provider()', () => {
    it("should throw error if provider wasn't initialized", () => {
      expect(() => service.provider).toThrow(
        new Error('LTI Provider not initialized!'),
      );
    });

    it('should return provider', () => {
      const prov = new Provider();
      service.provider = prov;
      expect(service.provider).toEqual(prov);
    });
  });

  describe('createLtiIdentityToken', () => {
    it('should throw error if JWT fails to be signed', async () => {
      const spy = jest.spyOn(JwtService.prototype, 'sign');

      spy.mockReturnValue(null as any);

      await expect(
        service.createLtiIdentityToken('lms', '0', 'anemail@example.com'),
      ).rejects.toThrow(ERROR_MESSAGES.ltiService.errorSigningJwt);

      spy.mockRestore();
    });

    it('should create JWT and return the token', async () => {
      const result = await service.createLtiIdentityToken(
        'lms',
        '0',
        'anemail@example.com',
      );

      expect(result).toBeDefined();
      expect(jwtService.verify(result)).toEqual(
        expect.objectContaining({
          iat: expect.anything(),
          code: expect.anything(),
        }),
      );
    });
  });

  describe('checkLtiIdentityToken', () => {
    let user: UserModel;

    beforeEach(async () => {
      user = await UserFactory.create();
    });

    it('should throw error if token invalid or missing code', async () => {
      let token = '';
      await expect(
        service.checkLtiIdentityToken(user.id, token),
      ).rejects.toThrow(ERROR_MESSAGES.ltiService.invalidIdentityJwt);

      token = jwtService.sign({});
      await expect(
        service.checkLtiIdentityToken(user.id, token),
      ).rejects.toThrow(ERROR_MESSAGES.ltiService.invalidIdentityJwt);
    });

    it('should return false if matching token not found', async () => {
      const token = jwtService.sign({ code: 'abc' });
      await expect(
        service.checkLtiIdentityToken(user.id, token),
      ).resolves.toEqual(false);
    });

    it('should return false if the token is expired', async () => {
      const tokenModel = await LtiIdentityTokenFactory.create({
        createdAt: new Date(Date.now() - 1000),
        expiresInSeconds: -1,
      });
      const token = jwtService.sign({
        code: tokenModel.code,
      });
      await expect(
        service.checkLtiIdentityToken(user.id, token),
      ).resolves.toEqual(false);
      expect(
        await LtiIdentityTokenModel.findOne({
          where: { code: tokenModel.code },
        }),
      ).toBeNull();
    });

    it.each(['create', 'update'])(
      'should succeed, %s identity entry & rival entries',
      async (mode: 'create' | 'update') => {
        const tokenModel = await LtiIdentityTokenFactory.create();
        const token = jwtService.sign({
          code: tokenModel.code,
        });

        await UserLtiIdentityFactory.create({
          user: user,
          issuer: tokenModel.issuer,
          ltiUserId: '0',
        });

        if (mode == 'update') {
          const secondary = await UserFactory.create();
          await UserLtiIdentityFactory.create({
            user: secondary,
            issuer: tokenModel.issuer,
            ltiUserId: tokenModel.ltiUserId,
          });
        }

        await expect(
          service.checkLtiIdentityToken(user.id, token),
        ).resolves.toEqual(true);

        const identity = await UserLtiIdentityModel.findOne({
          where: { userId: user.id, issuer: tokenModel.issuer },
        });
        expect(identity).toBeDefined();
        expect(identity.ltiUserId).toEqual(tokenModel.ltiUserId);
        expect(
          await UserLtiIdentityModel.find({
            where: {
              userId: Not(user.id),
              issuer: tokenModel.issuer,
              ltiUserId: tokenModel.ltiUserId,
            },
          }),
        ).toHaveLength(0);
      },
    );
  });

  describe('createCourseInvite', () => {
    it('should throw error if JWT fails to be signed', async () => {
      const course = await CourseFactory.create();
      const spy = jest.spyOn(JwtService.prototype, 'sign');

      spy.mockReturnValue(null as any);

      await expect(
        service.createCourseInvite(course.id, 'email'),
      ).rejects.toThrow(ERROR_MESSAGES.ltiService.errorSigningJwt);

      spy.mockRestore();
    });

    it('should create JWT and return the token', async () => {
      const course = await CourseFactory.create();

      const result = await service.createCourseInvite(course.id, 'email');

      expect(result).toBeDefined();
      expect(jwtService.verify(result)).toEqual(
        expect.objectContaining({
          courseId: course.id,
          iat: expect.anything(),
          inviteCode: expect.anything(),
        }),
      );
    });
  });

  describe('checkCourseInvite', () => {
    let user: UserModel;
    let course: CourseModel;

    beforeEach(async () => {
      user = await UserFactory.create();
      course = await CourseFactory.create();
    });

    it('should throw error if token invalid or missing properties', async () => {
      let token = '';
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.invalidInviteJwt,
      );

      token = jwtService.sign({ courseId: course.id });
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.invalidInviteJwt,
      );

      token = jwtService.sign({ courseId: 'ABC' });
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.invalidInviteJwt,
      );

      token = jwtService.sign({ inviteCode: 'abc' });
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.invalidInviteJwt,
      );
    });

    it('should throw error if matching invite not found', async () => {
      const token = jwtService.sign({ courseId: course.id, inviteCode: 'abc' });
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.ltiService.courseInviteNotFound),
      );
    });

    it('should throw error if invite email != user email', async () => {
      const invite = await LtiCourseInviteFactory.create({
        course,
        email: 'email@example.com',
      });
      const token = jwtService.sign({
        courseId: course.id,
        inviteCode: invite.inviteCode,
      });

      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.courseInviteEmailMismatch,
      );
    });

    it('should throw error if course belongs to different organization than user', async () => {
      const org0 = await OrganizationFactory.create();
      const org1 = await OrganizationFactory.create();

      await OrganizationUserFactory.create({
        organizationUser: user,
        organization: org0,
      });

      await OrganizationCourseFactory.create({
        course,
        organization: org1,
      });

      const invite = await LtiCourseInviteFactory.create({
        course,
        email: user.email,
      });
      const token = jwtService.sign({
        courseId: course.id,
        inviteCode: invite.inviteCode,
      });

      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        new NotFoundException(
          ERROR_MESSAGES.ltiService.courseInviteOrganizationMismatch,
        ),
      );
    });

    it('should throw error if the invite is expired', async () => {
      const org = await OrganizationFactory.create();
      await OrganizationUserFactory.create({
        organizationUser: user,
        organization: org,
      });
      await OrganizationCourseFactory.create({
        course,
        organization: org,
      });

      const invite = await LtiCourseInviteFactory.create({
        course,
        email: user.email,
        createdAt: new Date(Date.now() - 1000),
        expiresInSeconds: -1,
      });
      const token = jwtService.sign({
        courseId: course.id,
        inviteCode: invite.inviteCode,
      });
      await expect(service.checkCourseInvite(user.id, token)).rejects.toThrow(
        ERROR_MESSAGES.ltiService.courseInviteExpired,
      );
    });

    it('should succeed, create enrollment & delete invites like the invite', async () => {
      const org = await OrganizationFactory.create();
      await OrganizationUserFactory.create({
        organizationUser: user,
        organization: org,
      });
      await OrganizationCourseFactory.create({
        course,
        organization: org,
      });

      const invites: LtiCourseInviteModel[] = [];
      for (let i = 0; i < 3; i++) {
        invites.push(
          await LtiCourseInviteFactory.create({
            course,
            email: user.email,
          }),
        );
      }
      const token = jwtService.sign({
        courseId: course.id,
        inviteCode: invites[0].inviteCode,
      });
      await expect(service.checkCourseInvite(user.id, token)).resolves.toEqual(
        course.id,
      );

      expect(
        await LtiCourseInviteModel.find({
          where: {
            course,
            email: user.email,
          },
        }),
      ).toHaveLength(0);
    });
  });

  describe('(static) findMatchingUserCourse', () => {
    it('should return matching user', async () => {
      const user = await UserFactory.create({
        email: 'testuser@example.com',
      });
      const { userId, courseId } = await LtiService.findMatchingUserAndCourse({
        ...idToken,
        platformContext: {
          custom: undefined,
        },
      } as unknown as IdToken);
      expect(
        await UserLtiIdentityModel.findOne({
          where: {
            userId: user.id,
            issuer: idToken.iss,
          },
        }),
      ).toBeDefined();
      expect(userId).toEqual(user.id);
      expect(courseId).toBeUndefined();
    });

    it('should return matching user and course if course id was parseable', async () => {
      const user = await UserFactory.create({
        email: 'testuser@example.com',
      });
      const course = await CourseFactory.create();
      await UserCourseFactory.create({
        user,
        course,
      });
      await lmsCourseIntFactory.create({
        course,
        apiCourseId: idToken.platformContext.custom.canvas_course_id,
      });
      const { userId, courseId } = await LtiService.findMatchingUserAndCourse(
        idToken as unknown as IdToken,
      );
      expect(
        await UserLtiIdentityModel.findOne({
          where: {
            userId: user.id,
            issuer: idToken.iss,
          },
        }),
      ).toBeDefined();
      expect(userId).toEqual(user.id);
      expect(courseId).toEqual(course.id);
    });

    it('should use lti identity if user with email does not exist', async () => {
      const user = await UserFactory.create({
        email: 'fakeemail@example.com',
      });
      await UserLtiIdentityFactory.create({
        user,
        ltiUserId: idToken.user,
        issuer: idToken.iss,
      });
      const { userId } = await LtiService.findMatchingUserAndCourse(
        idToken as unknown as IdToken,
      );
      expect(userId).toEqual(user.id);
    });

    it('should prefer user lti identity if present over direct email', async () => {
      const user = await UserFactory.create({
        email: 'fakeemail@example.com',
      });
      await UserFactory.create({
        email: 'testuser@example.com',
      });
      await UserLtiIdentityFactory.create({
        user,
        ltiUserId: idToken.user,
        issuer: idToken.iss,
      });
      const { userId } = await LtiService.findMatchingUserAndCourse(
        idToken as unknown as IdToken,
      );
      expect(userId).toEqual(user.id);
    });
  });

  describe('resolveQuestionLaunch', () => {
    let org: Awaited<ReturnType<typeof OrganizationFactory.create>>;
    let course: CourseModel;
    let question: EmbeddableQuestionModel;
    const canvasCourseId = 'canvas-course-999';

    const createLaunchToken = (overrides?: LaunchTokenOverrides): IdToken =>
      ({
        iss: 'http://canvas.docker/',
        clientId: 'clientid',
        deploymentId: 'deploymentid',
        platformId: 'platformid',
        platformContext: {
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
          custom: {
            canvas_course_id: canvasCourseId,
            helpme_question_id: String(question.id),
          },
          ...overrides?.platformContext,
        },
        platformInfo: {
          product_family_code: 'canvas',
          ...overrides?.platformInfo,
        },
        user: 'learner-lti-sub-1',
        userInfo: {
          email: 'learner@example.com',
          given_name: 'Ada',
          family_name: 'Lovelace',
          ...overrides?.userInfo,
        },
        ...overrides,
      }) as unknown as IdToken;

    beforeEach(async () => {
      org = await OrganizationFactory.create();
      course = await CourseFactory.create();
      await OrganizationCourseFactory.create({
        course,
        organization: org,
      });
      await lmsCourseIntFactory.create({
        course,
        apiCourseId: canvasCourseId,
      });
      question = await EmbeddableQuestionModel.create({
        courseId: course.id,
        name: 'Reflection 1',
        questionText: 'Explain LTI 1.3 launch.',
        criteriaText: 'Clear and thoughtful reflection.',
        minSentences: 3,
        maxSentences: 5,
      }).save();
    });

    it('returns valid launch result for verified learner token', async () => {
      const token = createLaunchToken();
      const result = await service.resolveQuestionLaunch(token);

      expect(result).toEqual({
        userId: expect.any(Number),
        courseId: course.id,
        questionId: question.id,
      });

      const user = await UserModel.findOne({ where: { id: result.userId } });
      expect(user).toBeDefined();
    });

    it('provisions unknown learner once and creates STUDENT enrollment', async () => {
      const token = createLaunchToken({
        user: 'unknown-learner-id-99',
        userInfo: {
          email: 'unknown-learner@example.com',
          given_name: 'Grace',
          family_name: 'Hopper',
        },
      });

      const initialUserCount = await UserModel.count();
      const initialEnrollmentCount = await UserCourseModel.count();

      const result = await service.resolveQuestionLaunch(token);

      expect(await UserModel.count()).toBe(initialUserCount + 1);
      const user = await UserModel.findOne({
        where: { id: result.userId },
        relations: { organizationUser: true },
      });
      expect(user).toBeDefined();
      expect(user.password).toBeNull();
      expect(user.email).toBe('unknown-learner@example.com');
      expect(user.firstName).toBe('Grace');
      expect(user.lastName).toBe('Hopper');
      expect(user.organizationUser).toBeDefined();
      expect(user.organizationUser.organizationId).toBe(org.id);

      const identity = await UserLtiIdentityModel.findOne({
        where: {
          userId: user.id,
          issuer: token.iss,
        },
      });
      expect(identity).toBeDefined();
      expect(identity.ltiUserId).toBe('unknown-learner-id-99');
      expect(identity.ltiEmail).toBe('unknown-learner@example.com');

      expect(await UserCourseModel.count()).toBe(initialEnrollmentCount + 1);
      const enrollment = await UserCourseModel.findOne({
        where: {
          userId: user.id,
          courseId: course.id,
        },
      });
      expect(enrollment).toBeDefined();
      expect(enrollment.role).toBe(Role.STUDENT);
    });

    it('links to existing user when asserted email matches exactly one suitable user in mapped organization', async () => {
      const existingUser = await UserFactory.create({
        email: 'pre-existing@example.com',
      });
      await OrganizationUserFactory.create({
        organizationUser: existingUser,
        organization: org,
      });

      const token = createLaunchToken({
        user: 'new-sub-for-existing-user',
        userInfo: {
          email: 'pre-existing@example.com',
        },
      });

      const initialUserCount = await UserModel.count();
      const result = await service.resolveQuestionLaunch(token);

      expect(result.userId).toBe(existingUser.id);
      expect(await UserModel.count()).toBe(initialUserCount);

      const identity = await UserLtiIdentityModel.findOne({
        where: {
          userId: existingUser.id,
          issuer: token.iss,
        },
      });
      expect(identity).toBeDefined();
      expect(identity.ltiUserId).toBe('new-sub-for-existing-user');

      const enrollment = await UserCourseModel.findOne({
        where: {
          userId: existingUser.id,
          courseId: course.id,
        },
      });
      expect(enrollment).toBeDefined();
      expect(enrollment.role).toBe(Role.STUDENT);
    });

    it('provisions new user if existing user with matching email belongs to a different organization', async () => {
      const rivalOrg = await OrganizationFactory.create();
      const rivalUser = await UserFactory.create({
        email: 'shared@example.com',
      });
      await OrganizationUserFactory.create({
        organizationUser: rivalUser,
        organization: rivalOrg,
      });

      const token = createLaunchToken({
        user: 'sub-new-for-org',
        userInfo: {
          email: 'shared@example.com',
        },
      });

      const initialUserCount = await UserModel.count();
      const result = await service.resolveQuestionLaunch(token);

      expect(result.userId).not.toBe(rivalUser.id);
      expect(await UserModel.count()).toBe(initialUserCount + 1);

      const user = await UserModel.findOne({
        where: { id: result.userId },
        relations: { organizationUser: true },
      });
      expect(user.organizationUser.organizationId).toBe(org.id);
    });

    it('reuses both user and enrollment on repeated iss + sub launch', async () => {
      const token = createLaunchToken({
        user: 'repeat-learner-42',
        userInfo: {
          email: 'repeat-learner@example.com',
        },
      });

      const firstResult = await service.resolveQuestionLaunch(token);
      const userCountAfterFirst = await UserModel.count();
      const enrollmentCountAfterFirst = await UserCourseModel.count();

      const secondResult = await service.resolveQuestionLaunch(token);

      expect(secondResult.userId).toBe(firstResult.userId);
      expect(secondResult.courseId).toBe(course.id);
      expect(secondResult.questionId).toBe(question.id);
      expect(await UserModel.count()).toBe(userCountAfterFirst);
      expect(await UserCourseModel.count()).toBe(enrollmentCountAfterFirst);
    });

    it('rejects unmapped course without provisioning', async () => {
      const token = createLaunchToken({
        platformContext: {
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
          custom: {
            canvas_course_id: 'unmapped-canvas-course-xyz',
            helpme_question_id: String(question.id),
          },
        },
      });

      await expect(service.resolveQuestionLaunch(token)).rejects.toThrow();
      expect(await UserModel.count()).toBe(0);
      expect(await UserCourseModel.count()).toBe(0);
      expect(await UserLtiIdentityModel.count()).toBe(0);
    });

    it.each([
      ['missing question parameter', undefined],
      ['empty question parameter', ''],
      ['zero question id', '0'],
      ['negative question id', '-5'],
      ['alpha question id', 'abc'],
      ['float question id', '1.5'],
      ['octal/leading zero question id', '012'],
    ])('rejects %s without provisioning', async (_, questionParam) => {
      const token = createLaunchToken({
        platformContext: {
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
          custom: {
            canvas_course_id: canvasCourseId,
            ...(questionParam !== undefined
              ? { helpme_question_id: questionParam }
              : {}),
          },
        },
      });

      await expect(service.resolveQuestionLaunch(token)).rejects.toThrow();
      expect(await UserModel.count()).toBe(0);
      expect(await UserCourseModel.count()).toBe(0);
      expect(await UserLtiIdentityModel.count()).toBe(0);
    });

    it('rejects cross-course question without provisioning', async () => {
      const course2 = await CourseFactory.create();
      const questionCourse2 = await EmbeddableQuestionModel.create({
        courseId: course2.id,
        name: 'Question Course 2',
        questionText: 'Prompt 2',
        criteriaText: 'Rubric 2',
      }).save();

      const token = createLaunchToken({
        platformContext: {
          roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
          custom: {
            canvas_course_id: canvasCourseId,
            helpme_question_id: String(questionCourse2.id),
          },
        },
      });

      await expect(service.resolveQuestionLaunch(token)).rejects.toThrow();
      expect(await UserModel.count()).toBe(0);
      expect(await UserCourseModel.count()).toBe(0);
      expect(await UserLtiIdentityModel.count()).toBe(0);
    });

    it.each([
      [
        'instructor role',
        ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
      ],
      [
        'ta role',
        ['http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant'],
      ],
      ['empty roles array', []],
      ['undefined roles', undefined],
    ])('rejects non-learner with %s without provisioning', async (_, roles) => {
      const token = createLaunchToken({
        platformContext: {
          roles,
          custom: {
            canvas_course_id: canvasCourseId,
            helpme_question_id: String(question.id),
          },
        },
      });

      await expect(service.resolveQuestionLaunch(token)).rejects.toThrow();
      expect(await UserModel.count()).toBe(0);
      expect(await UserCourseModel.count()).toBe(0);
      expect(await UserLtiIdentityModel.count()).toBe(0);
    });
  });
});
