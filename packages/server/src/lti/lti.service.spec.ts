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
import { HELPME_QUESTION_ID_PARAM, LtiService } from './lti.service';
import { EMBEDDABLE_RESOURCE_KIND } from './embeddable/resource/embeddable-resource-auth';
import { IdToken, Provider } from '@bhunt02/lti-typescript';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES, Role } from '@koh/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModel } from '../profile/user.entity';
import { CourseModel } from '../course/course.entity';
import { LtiCourseInviteModel } from './lti-course-invite.entity';
import { LtiIdentityTokenModel } from './lti_identity_token.entity';
import { UserLtiIdentityModel } from './user_lti_identity.entity';
import { EmbeddableQuestionModel } from './embeddable/question/embeddable-question.entity';
import { EmbeddableQuestionService } from './embeddable/question/embeddable-question.service';
import { UserCourseModel } from '../profile/user-course.entity';
import { OrganizationUserModel } from '../organization/organization-user.entity';
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
    guid: 'ubc-platform-guid',
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
  let configService: ConfigService;
  let initialLtiCanvasConfig: {
    issuer: string;
    clientId: string;
    platformGuid: string;
  };
  const initialLtiCanvasEnv = {
    issuer: process.env.LTI_CANVAS_ISSUER,
    clientId: process.env.LTI_CANVAS_CLIENT_ID,
    platformGuid: process.env.LTI_CANVAS_PLATFORM_GUID,
  };
  const embeddableQuestionService = {
    findAllForCourse: jest.fn(),
    findOne: jest.fn(),
  };

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
      providers: [
        LtiService,
        {
          provide: EmbeddableQuestionService,
          useValue: embeddableQuestionService,
        },
      ],
    }).compile();

    service = module.get<LtiService>(LtiService);
    dataSource = module.get<DataSource>(DataSource);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
    initialLtiCanvasConfig = {
      issuer: configService.get<string>('LTI_CANVAS_ISSUER'),
      clientId: configService.get<string>('LTI_CANVAS_CLIENT_ID'),
      platformGuid: configService.get<string>('LTI_CANVAS_PLATFORM_GUID'),
    };

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

  afterEach(() => {
    configService.set('LTI_CANVAS_ISSUER', initialLtiCanvasConfig.issuer);
    configService.set('LTI_CANVAS_CLIENT_ID', initialLtiCanvasConfig.clientId);
    configService.set(
      'LTI_CANVAS_PLATFORM_GUID',
      initialLtiCanvasConfig.platformGuid,
    );
    if (initialLtiCanvasEnv.issuer === undefined) {
      delete process.env.LTI_CANVAS_ISSUER;
    } else {
      process.env.LTI_CANVAS_ISSUER = initialLtiCanvasEnv.issuer;
    }
    if (initialLtiCanvasEnv.clientId === undefined) {
      delete process.env.LTI_CANVAS_CLIENT_ID;
    } else {
      process.env.LTI_CANVAS_CLIENT_ID = initialLtiCanvasEnv.clientId;
    }
    if (initialLtiCanvasEnv.platformGuid === undefined) {
      delete process.env.LTI_CANVAS_PLATFORM_GUID;
    } else {
      process.env.LTI_CANVAS_PLATFORM_GUID = initialLtiCanvasEnv.platformGuid;
    }
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
          guid: 'ubc-platform-guid',
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

    const expectZeroWrites = async () => {
      expect(await UserModel.count()).toBe(0);
      expect(await OrganizationUserModel.count()).toBe(0);
      expect(await UserCourseModel.count()).toBe(0);
      expect(await UserLtiIdentityModel.count()).toBe(0);
    };

    const expectRejectedWithoutWrites = async (token: IdToken) => {
      await expect(service.resolveQuestionLaunch(token)).rejects.toThrow();
      await expectZeroWrites();
    };

    beforeEach(async () => {
      configService.set('LTI_CANVAS_ISSUER', 'http://canvas.docker/');
      configService.set('LTI_CANVAS_CLIENT_ID', 'clientid');
      configService.set('LTI_CANVAS_PLATFORM_GUID', 'ubc-platform-guid');
      course = await CourseFactory.create();
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

    it('returns a learner resource payload without creating any user, org membership, enrollment, or identity', async () => {
      const token = createLaunchToken({
        user: 'unknown-learner-id-99',
        userInfo: {
          email: 'unknown-learner@example.com',
          given_name: 'Grace',
          family_name: 'Hopper',
        },
      });

      const result = await service.resolveQuestionLaunch(token);

      expect(result.courseId).toBe(course.id);
      expect(result.questionId).toBe(question.id);
      expect(result.resource).toMatchObject({
        kind: EMBEDDABLE_RESOURCE_KIND,
        role: 'learner',
        ltiIssuer: token.iss,
        ltiSubject: 'unknown-learner-id-99',
        courseId: course.id,
        questionId: question.id,
      });
      expect(result.resource).not.toHaveProperty('email');
      expect(result.resource).not.toHaveProperty('userId');
      await expectZeroWrites();
    });

    it('creates nothing even when the Canvas email matches an existing HelpMe user', async () => {
      const existingUser = await UserFactory.create({
        email: 'pre-existing@example.com',
      });
      const userCount = await UserModel.count();

      const result = await service.resolveQuestionLaunch(
        createLaunchToken({
          user: 'new-sub-for-existing-user',
          userInfo: {
            email: 'pre-existing@example.com',
          },
        }),
      );

      expect(result.resource).toMatchObject({
        kind: EMBEDDABLE_RESOURCE_KIND,
        ltiIssuer: 'http://canvas.docker/',
        ltiSubject: 'new-sub-for-existing-user',
        courseId: course.id,
        questionId: question.id,
      });
      expect(await UserModel.count()).toBe(userCount);
      expect(
        await UserLtiIdentityModel.find({
          where: {
            issuer: 'http://canvas.docker/',
            ltiUserId: 'new-sub-for-existing-user',
          },
        }),
      ).toHaveLength(0);
      expect(
        await UserCourseModel.findOneBy({
          userId: existingUser.id,
          courseId: course.id,
        }),
      ).toBeNull();
    });

    it.each([
      ['issuer', { iss: 'https://other.canvas.example/' }],
      ['client ID', { clientId: 'other-client' }],
      [
        'platform GUID',
        {
          platformInfo: {
            product_family_code: 'canvas',
            guid: 'other-platform-guid',
          },
        },
      ],
    ])('rejects mismatched %s without writes', async (_field, override) => {
      await expectRejectedWithoutWrites(createLaunchToken(override));
    });

    it.each([
      'LTI_CANVAS_ISSUER',
      'LTI_CANVAS_CLIENT_ID',
      'LTI_CANVAS_PLATFORM_GUID',
    ])('fails closed when %s is missing', async (key) => {
      configService.set(key, '');

      await expect(
        service.resolveQuestionLaunch(createLaunchToken()),
      ).rejects.toThrow(InternalServerErrorException);
      await expectZeroWrites();
    });

    it('rejects unmapped course without writing', async () => {
      await expectRejectedWithoutWrites(
        createLaunchToken({
          platformContext: {
            roles: [
              'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
            ],
            custom: {
              canvas_course_id: 'unmapped-canvas-course-xyz',
              helpme_question_id: String(question.id),
            },
          },
        }),
      );
    });

    it('rejects a malformed question id without writing', async () => {
      await expectRejectedWithoutWrites(
        createLaunchToken({
          platformContext: {
            roles: [
              'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
            ],
            custom: {
              canvas_course_id: canvasCourseId,
              helpme_question_id: 'abc',
            },
          },
        }),
      );
    });

    it('rejects cross-course question without writing', async () => {
      const course2 = await CourseFactory.create();
      const questionCourse2 = await EmbeddableQuestionModel.create({
        courseId: course2.id,
        name: 'Question Course 2',
        questionText: 'Prompt 2',
        criteriaText: 'Rubric 2',
      }).save();

      await expectRejectedWithoutWrites(
        createLaunchToken({
          platformContext: {
            roles: [
              'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
            ],
            custom: {
              canvas_course_id: canvasCourseId,
              helpme_question_id: String(questionCourse2.id),
            },
          },
        }),
      );
    });

    it('rejects a launch without a standard role without writing', async () => {
      await expectRejectedWithoutWrites(
        createLaunchToken({
          platformContext: {
            roles: [],
            custom: {
              canvas_course_id: canvasCourseId,
              helpme_question_id: String(question.id),
            },
          },
        }),
      );
    });
  });

  describe('deep linking', () => {
    const canvasCourseId = 'canvas-course-deep-link';
    const instructorEmail = 'instructor@example.com';
    const instructorSub = 'instructor-sub-1';
    const launchUrl = 'http://helpme.test/api/v1/lti';
    const createDeepLinkingForm = jest.fn();
    const getPlatform = jest.fn();

    const buildToken = (
      overrides: { user?: string; email?: string } = {},
    ): IdToken =>
      ({
        iss: 'http://canvas.docker/',
        clientId: 'helpme-client-id',
        deploymentId: 'deployment-1',
        platformId: 'platform-1',
        platformContext: {
          messageType: 'LtiDeepLinkingRequest',
          roles: [
            'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
          ],
          deepLinkingSettings: {
            deep_link_return_url: 'https://canvas.docker/deep-link-return',
            accept_types: ['ltiResourceLink'],
            accept_presentation_document_targets: ['iframe'],
          },
          custom: { canvas_course_id: canvasCourseId },
          targetLinkUri: launchUrl,
        },
        platformInfo: {
          product_family_code: 'canvas',
          guid: 'ubc-platform-guid',
        },
        user: overrides.user ?? instructorSub,
        userInfo: { email: overrides.email ?? instructorEmail },
      }) as unknown as IdToken;

    const seedMappedCourse = async () => {
      const course = await CourseFactory.create();
      await lmsCourseIntFactory.create({
        course,
        apiCourseId: canvasCourseId,
      });
      return course;
    };

    const seedInstructor = async (course: CourseModel, role: Role) => {
      const user = await UserFactory.create({ email: instructorEmail });
      await UserLtiIdentityFactory.create({
        user,
        issuer: 'http://canvas.docker/',
        ltiUserId: instructorSub,
      });
      await UserCourseFactory.create({ user, course, role });
      return user;
    };

    beforeEach(() => {
      configService.set('LTI_CANVAS_ISSUER', 'http://canvas.docker/');
      configService.set('LTI_CANVAS_CLIENT_ID', 'helpme-client-id');
      configService.set('LTI_CANVAS_PLATFORM_GUID', 'ubc-platform-guid');
      getPlatform.mockReset().mockResolvedValue({ active: true });
      createDeepLinkingForm.mockReset();
      embeddableQuestionService.findAllForCourse.mockReset();
      embeddableQuestionService.findOne.mockReset();
      service.provider = {
        getPlatform,
        DeepLinkingService: { createDeepLinkingForm },
      } as unknown as Provider;
    });

    it.each([Role.PROFESSOR, Role.TA])(
      'authorizes an existing %s enrollment without provisioning',
      async (role) => {
        const course = await seedMappedCourse();
        const user = await seedInstructor(course, role);
        const userCount = await UserModel.count();
        const enrollmentCount = await UserCourseModel.count();

        await expect(
          service.authorizeDeepLinking(buildToken()),
        ).resolves.toEqual({ userId: user.id, courseId: course.id });
        expect(await UserModel.count()).toBe(userCount);
        expect(await UserCourseModel.count()).toBe(enrollmentCount);
      },
    );

    it('rejects a student without elevating the enrollment', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.STUDENT);

      await expect(service.authorizeDeepLinking(buildToken())).rejects.toThrow(
        ForbiddenException,
      );
      expect(
        await UserCourseModel.findOneBy({ courseId: course.id }),
      ).toMatchObject({ role: Role.STUDENT });
    });

    it('rejects an instructor enrolled only in another course', async () => {
      const mappedCourse = await seedMappedCourse();
      const otherCourse = await CourseFactory.create();
      const user = await seedInstructor(otherCourse, Role.PROFESSOR);

      await expect(service.authorizeDeepLinking(buildToken())).rejects.toThrow(
        ForbiddenException,
      );
      expect(
        await UserCourseModel.findOneBy({
          userId: user.id,
          courseId: mappedCourse.id,
        }),
      ).toBeNull();
    });

    it('rejects an unknown Canvas identity without provisioning it', async () => {
      await seedMappedCourse();

      await expect(
        service.authorizeDeepLinking(
          buildToken({ user: 'unknown', email: 'unknown@example.com' }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(await UserModel.count()).toBe(0);
    });

    it('rejects a matching email without a verified iss+sub identity and binds nothing', async () => {
      const course = await seedMappedCourse();
      const user = await UserFactory.create({ email: instructorEmail });
      await UserCourseFactory.create({
        user,
        course,
        role: Role.PROFESSOR,
      });

      await expect(service.authorizeDeepLinking(buildToken())).rejects.toThrow(
        ForbiddenException,
      );
      expect(
        await UserLtiIdentityModel.find({
          where: { issuer: 'http://canvas.docker/', ltiUserId: instructorSub },
        }),
      ).toHaveLength(0);
    });

    it('rejects a launch from an inactive Canvas platform', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.PROFESSOR);
      getPlatform.mockResolvedValue({ active: false });

      await expect(service.authorizeDeepLinking(buildToken())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a launch from another Canvas root platform', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.PROFESSOR);
      const token = buildToken();
      token.platformInfo.guid = 'other-platform-guid';

      await expect(service.authorizeDeepLinking(token)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns one library-signed ungraded Resource Link for the selected question', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.TA);
      const token = buildToken();
      const question = EmbeddableQuestionModel.create({
        id: 42,
        courseId: course.id,
        name: 'Week 3',
      });
      embeddableQuestionService.findOne.mockResolvedValue(question);
      createDeepLinkingForm.mockResolvedValue('<form>deep-link</form>');

      await expect(
        service.createDeepLinkingResponse(token, question.id),
      ).resolves.toBe('<form>deep-link</form>');
      expect(createDeepLinkingForm).toHaveBeenCalledWith(
        token,
        {
          type: 'ltiResourceLink',
          title: 'Week 3',
          url: launchUrl,
          custom: { [HELPME_QUESTION_ID_PARAM]: '42' },
          iframe: { src: launchUrl, width: 800, height: 300 },
        },
        { message: 'HelpMe question linked' },
      );
      expect(createDeepLinkingForm.mock.calls[0][1]).not.toHaveProperty(
        'lineItem',
      );
    });

    it('rejects a cross-course question before signing', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.PROFESSOR);
      embeddableQuestionService.findOne.mockRejectedValue(
        new NotFoundException('Question not found'),
      );

      await expect(
        service.createDeepLinkingResponse(buildToken(), 1234),
      ).rejects.toThrow(NotFoundException);
      expect(createDeepLinkingForm).not.toHaveBeenCalled();
    });

    it('rejects loosely-coerced question selections before signing', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.PROFESSOR);
      const token = buildToken();

      for (const coerced of [true, [42], 1.5, 0, ' 42', '1e3', '0x2A', '-3']) {
        await expect(
          service.createDeepLinkingResponse(token, coerced),
        ).rejects.toThrow(BadRequestException);
      }
      expect(embeddableQuestionService.findOne).not.toHaveBeenCalled();
      expect(createDeepLinkingForm).not.toHaveBeenCalled();
    });

    it('rejects a signed response when the verified target link URI is missing', async () => {
      const course = await seedMappedCourse();
      await seedInstructor(course, Role.PROFESSOR);
      const question = EmbeddableQuestionModel.create({
        id: 42,
        courseId: course.id,
        name: 'Week 3',
      });
      embeddableQuestionService.findOne.mockResolvedValue(question);

      for (const targetLinkUri of [undefined, '']) {
        const token = buildToken();
        token.platformContext.targetLinkUri = targetLinkUri as string;
        await expect(
          service.createDeepLinkingResponse(token, 42),
        ).rejects.toThrow(BadRequestException);
      }
      expect(createDeepLinkingForm).not.toHaveBeenCalled();
    });
  });
});
