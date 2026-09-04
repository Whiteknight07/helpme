import { setupIntegrationTest } from './util/testUtils';
import { LtiModule } from '../src/lti/lti.module';
import {
  AuthTokenMethodEnum,
  Database,
  IdToken,
  Provider,
  register,
} from '@bhunt02/lti-typescript';
import { UserModel } from '../src/profile/user.entity';
import { CourseModel } from '../src/course/course.entity';
import {
  CourseFactory,
  lmsCourseIntFactory,
  OrganizationCourseFactory,
  OrganizationFactory,
  UserCourseFactory,
  UserFactory,
  UserLtiIdentityFactory,
} from './util/factories';
import express from 'express';
import {
  AuthMethodEnum,
  CreateLtiPlatform,
  ERROR_MESSAGES,
  LtiPlatform,
  Role,
  UpdateLtiPlatform,
  UserRole,
} from '@koh/common';
import { mapToLocalPlatform } from '../src/lti/lti.controller';
import {
  LTI_MEMBERSHIP_LEARNER_ROLE,
  LtiService,
} from '../src/lti/lti.service';
import { EmbeddableQuestionModel } from '../src/lti/embeddable/question/embeddable-question.entity';
import { JwtService } from '@nestjs/jwt';

const testEncryptionKey = 'abcdefg';
const testLtiDbOptions: any = {
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: process.env.POSTGRES_NONROOT_USER,
  password: process.env.POSTGRES_NONROOT_PASSWORD,
  database: 'lti_test',
};

jest.setTimeout(20000);
describe('LtiController', () => {
  let ltiService: LtiService;
  let provider: Provider;
  let platforms: LtiPlatform[] = [];
  let user: UserModel;
  let course: CourseModel;
  let customToken: IdToken | null | undefined;

  const mockMiddleware = (
    _: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (customToken === null) {
      res.locals.token = undefined;
    } else if (customToken !== undefined) {
      res.locals.token = customToken;
      if (!LtiService.hasQuestionLaunch(customToken)) {
        res.locals.userId = user?.id;
        res.locals.courseId = course?.id;
      }
    } else {
      res.locals.token = {
        iss: 'fake-issuer',
        user: '0',
        userInfo: { email: 'fake_email@example.com' },
        platformInfo: { product_family_code: 'canvas' },
        platformContext: { custom: { canvas_course_id: 'abcdefg' } },
      };
      res.locals.userId = user?.id;
      res.locals.courseId = course?.id;
    }

    next();
  };

  const { supertest, getTestModule } = setupIntegrationTest(
    LtiModule,
    undefined,
    undefined,
    [mockMiddleware],
  );

  beforeAll(async () => {
    // Initialize connection to LTI database (override library parameters for test)
    await Database.initializeDatabase(
      testLtiDbOptions,
      testEncryptionKey,
      true,
    );
  });

  beforeEach(async () => {
    customToken = undefined;
    ltiService = getTestModule().get<LtiService>(LtiService);

    provider = await register(testEncryptionKey, testLtiDbOptions, {});

    ltiService.provider = provider;

    user = await UserFactory.create();
    course = await CourseFactory.create();
    platforms = [];
    for (let i = 0; i < 3; i++) {
      const platform = await provider.registerPlatform({
        name: `platform${i + 1}`,
        platformUrl: 'http://platform.com',
        clientId: String(i + 1),
        accessTokenEndpoint: 'http://platform.com/keys',
        authenticationEndpoint: 'http://platform.com/auth',
        authToken: {
          method: AuthTokenMethodEnum.JWK_SET,
          key: 'http://platform.com/keys',
        },
        active: true,
      });
      platforms.push(mapToLocalPlatform(platform['platformModel']));
    }
  });

  afterEach(async () => {
    await Database.dataSource.synchronize(true);
  });

  afterAll(async () => {
    await provider.close();
  });

  describe('ALL lti/', () => {
    it('should redirect to login if user and/or course not found', async () => {
      user = undefined;
      course = undefined;
      await supertest()
        .get('/lti')
        .expect(302)
        .then((response) => {
          const location = new URL(
            'https://example.com' + response.headers['location'],
          );
          expect(response.headers['set-cookie']?.[0]).toEqual(
            expect.stringContaining('__LTI_IDENTITY='),
          );
          expect(location.pathname).toEqual(`/lti/login`);
        });
    });

    it('should create course invite if user does not exist but course found', async () => {
      user = undefined;
      await supertest()
        .get('/lti')
        .expect(302)
        .then((response) => {
          const location = new URL(
            'https://example.com' + response.headers['location'],
          );
          expect(response.headers['set-cookie']?.[0]).toEqual(
            expect.stringContaining('__LTI_IDENTITY='),
          );
          expect(response.headers['set-cookie']?.[1]).toEqual(
            expect.stringContaining('__COURSE_INVITE='),
          );
          expect(location.pathname).toEqual(`/lti/login`);
          expect(location.searchParams.get('redirect')).toEqual(
            `/lti/${course.id}`,
          );
        });
    });

    it('should redirect to lti courses page', async () => {
      await supertest()
        .get('/lti')
        .expect(302)
        .then((response) => {
          const location = new URL(
            'https://example.com' + response.headers['location'],
          );
          expect(location.pathname).toEqual(`/lti/${course.id}`);
          expect(location.searchParams.get('api_course_id')).toEqual('abcdefg');
          expect(location.searchParams.get('lms_platform')).toEqual('Canvas');
        });
    });

    describe('question launch', () => {
      const setupQuestionLaunch = async (
        roles = [LTI_MEMBERSHIP_LEARNER_ROLE],
      ) => {
        const organization = await OrganizationFactory.create();
        const launchCourse = await CourseFactory.create();
        await OrganizationCourseFactory.create({
          course: launchCourse,
          organization,
        });
        await lmsCourseIntFactory.create({
          course: launchCourse,
          apiCourseId: 'canvas-launch-cid',
        });
        const question = await EmbeddableQuestionModel.create({
          courseId: launchCourse.id,
          questionText: 'Question text',
          criteriaText: 'Criteria text',
        }).save();

        customToken = {
          iss: 'https://canvas.example.edu',
          user: 'canvas-learner-1',
          userInfo: {
            email: 'learner@example.edu',
            given_name: 'Jane',
            family_name: 'Learner',
          },
          platformInfo: { product_family_code: 'canvas' },
          platformContext: {
            roles,
            custom: {
              canvas_course_id: 'canvas-launch-cid',
              helpme_question_id: String(question.id),
            },
          },
        } as unknown as IdToken;

        return { organization, launchCourse, question };
      };

      it('should provision a learner question launch, set restricted cookie, and redirect to the feedback route', async () => {
        const { organization, launchCourse, question } =
          await setupQuestionLaunch();

        const res = await supertest().get('/lti').expect(302);
        const location = new URL(
          'https://example.com' + res.headers['location'],
        );
        expect(location.pathname).toEqual(
          `/lti/embeddable/${launchCourse.id}/question/${question.id}`,
        );

        const authCookie = res
          .get('Set-Cookie')
          .find((cookie) => cookie.startsWith('lti_auth_token='));
        if (!authCookie) throw new Error('Missing lti_auth_token cookie');
        const cookieValue = authCookie
          .split(';')[0]
          .slice('lti_auth_token='.length);
        const jwtService = getTestModule().get<JwtService>(JwtService);
        const decoded = jwtService.verify<{
          userId: number;
          expiresIn: number;
        }>(cookieValue);

        expect(decoded).toMatchObject({
          expiresIn: 600,
        });

        await supertest()
          .get(`/organization/${organization.id}`)
          .set('Cookie', [`lti_auth_token=${cookieValue}`])
          .expect(403);

        await supertest()
          .get(`/lti/embeddable-question/${launchCourse.id}/${question.id}`)
          .set('Cookie', [`lti_auth_token=${cookieValue}`])
          .expect(200);
      });

      it('should fail with 403 and cannot provision when LTI token is absent', async () => {
        const countBefore = await UserModel.count();
        customToken = null;

        await supertest().get('/lti').expect(403);

        const countAfter = await UserModel.count();
        expect(countAfter).toEqual(countBefore);
      });

      it('should launch an existing instructor preview without provisioning', async () => {
        const { launchCourse, question } = await setupQuestionLaunch([
          'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
        ]);
        const instructor = await UserFactory.create({
          email: 'instructor@example.edu',
        });
        await UserLtiIdentityFactory.create({
          user: instructor,
          issuer: 'https://canvas.example.edu',
          ltiUserId: 'canvas-learner-1',
        });
        await UserCourseFactory.create({
          user: instructor,
          course: launchCourse,
          role: Role.PROFESSOR,
        });
        const countBefore = await UserModel.count();

        const response = await supertest().get('/lti').expect(302);
        expect(response.headers.location).toEqual(
          `/lti/embeddable/${launchCourse.id}/question/${question.id}`,
        );
        expect(await UserModel.count()).toEqual(countBefore);
      });

      it('should not provision an unknown instructor question launch', async () => {
        await setupQuestionLaunch([
          'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
        ]);
        const countBefore = await UserModel.count();

        await supertest().get('/lti').expect(403);
        expect(await UserModel.count()).toEqual(countBefore);
      });
    });
  });

  describe('GET lti/platform', () => {
    const url = '/lti/platform';

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .get(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .get(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should succeed with 200 and return HMS-platform representation list', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      await supertest({ userId: user.id })
        .get(url)
        .expect(200)
        .then((response) => {
          expect(response.body).toEqual(expect.arrayContaining(platforms));
        });
    });
  });

  describe('GET lti/platform/:kid', () => {
    let url: string;

    beforeEach(async () => {
      url = `/lti/platform/${platforms[0].kid}`;
    });

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .get(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .get(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should succeed with 200 and return HMS-platform representation', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      await supertest({ userId: user.id })
        .get(url)
        .expect(200)
        .then((response) => {
          expect(response.body).toEqual(platforms[0]);
        });
    });
  });

  describe('POST lti/platform', () => {
    const url = '/lti/platform';

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .post(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .post(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should fail with 400 if missing properties or properties incorrect', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      await supertest({ userId: user.id }).post(url).expect(400);
    });

    it('should succeed with 201 and return HMS-platform representation', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      const props = {
        platformUrl: 'http://platform.com',
        clientId: '4',
        name: 'platform4',
        authenticationEndpoint: 'http://platform.com/auth',
        accessTokenEndpoint: 'http://platform.com/keys',
        active: true,
        authToken: {
          method: AuthMethodEnum.JWK_SET,
          key: 'http://platform.com/keys',
        },
      } satisfies CreateLtiPlatform;

      await supertest({ userId: user.id })
        .post(url)
        .send(props)
        .expect(201)
        .then((response) => {
          expect(response.body).toEqual(
            expect.objectContaining({
              ...props,
            }),
          );
        });
    });
  });

  describe('PATCH lti/platform/:kid', () => {
    let url: string;

    beforeEach(async () => {
      url = `/lti/platform/${platforms[0].kid}`;
    });

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .patch(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .patch(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should succeed with 200 and return HMS-platform representation', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      const props = {
        platformUrl: 'http://platform.com',
        clientId: '4',
        name: 'platform4',
        authenticationEndpoint: 'http://platform.com/auth',
        accessTokenEndpoint: 'http://platform.com/keys',
        active: true,
        authToken: {
          method: AuthMethodEnum.JWK_SET,
          key: 'http://platform.com/keys',
        },
      } satisfies UpdateLtiPlatform;

      await supertest({ userId: user.id })
        .patch(url)
        .send(props)
        .expect(200)
        .then((response) => {
          expect(response.body).toEqual(
            expect.objectContaining({
              ...props,
            }),
          );
        });

      const prov = mapToLocalPlatform(
        (await provider.getPlatformById(platforms[0].kid))['platformModel'],
      );
      expect(prov).toEqual(expect.objectContaining({ ...props }));
    });
  });

  describe('DELETE lti/platform/:kid', () => {
    let url: string;

    beforeEach(async () => {
      url = `/lti/platform/${platforms[0].kid}`;
    });

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .delete(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .delete(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should succeed with 200', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      await supertest({ userId: user.id }).delete(url).expect(200);

      const found = await provider.getPlatformById(platforms[0].kid);
      expect(found).toBeUndefined();
    });
  });

  describe('POST lti/platform/:kid/toggle', () => {
    let url: string;

    beforeEach(async () => {
      url = `/lti/platform/${platforms[0].kid}/toggle`;
    });

    it('should fail with 401 if user is unauthorized', async () => {
      await supertest()
        .patch(url)
        .expect(401)
        .then((response) => {
          expect(response.body).toHaveProperty('message', 'Unauthorized');
        });
    });

    it('should fail with 403 if user does not have website admin role', async () => {
      const user = await UserFactory.create();
      await supertest({ userId: user.id })
        .patch(url)
        .expect(403)
        .then((response) => {
          expect(response.body).toHaveProperty(
            'message',
            ERROR_MESSAGES.roleGuard.mustBeRoleToAccess([UserRole.ADMIN]),
          );
        });
    });

    it('should enable/disable platform', async () => {
      const user = await UserFactory.create({ userRole: UserRole.ADMIN });

      await supertest({ userId: user.id }).patch(url).expect(200);

      let found = await provider.getPlatformById(platforms[0].kid);
      expect(found.active).toEqual(false);

      await supertest({ userId: user.id }).patch(url).expect(200);

      found = await provider.getPlatformById(platforms[0].kid);
      expect(found.active).toEqual(true);
    });
  });
});
