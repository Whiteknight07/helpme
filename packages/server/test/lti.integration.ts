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
import { OrganizationUserModel } from '../src/organization/organization-user.entity';
import { UserCourseModel } from '../src/profile/user-course.entity';
import { UserLtiIdentityModel } from '../src/lti/user_lti_identity.entity';
import {
  CourseFactory,
  lmsCourseIntFactory,
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
import {
  EMBEDDABLE_RESOURCE_TTL_SECONDS,
  resourceCookieName,
  resourceCookiePath,
} from '../src/lti/embeddable/resource/embeddable-resource-auth';
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
        const launchCourse = await CourseFactory.create();
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

        return { launchCourse, question };
      };

      const tableCounts = async () => ({
        users: await UserModel.count(),
        orgUsers: await OrganizationUserModel.count(),
        enrollments: await UserCourseModel.count(),
        identities: await UserLtiIdentityModel.count(),
      });

      it('issues a scoped learner cookie without any user, org, enrollment, or identity writes', async () => {
        const { launchCourse, question } = await setupQuestionLaunch();
        const before = await tableCounts();

        const res = await supertest().get('/lti').expect(302);
        const location = new URL(
          'https://example.com' + res.headers['location'],
        );
        expect(location.pathname).toEqual(
          `/lti/embeddable/${launchCourse.id}/question/${question.id}`,
        );
        expect(location.searchParams.get('resource')).toEqual('1');

        const cookies: string[] = res.get('Set-Cookie') ?? [];
        const scopedName = resourceCookieName(launchCourse.id, question.id);
        const scoped = cookies.find((cookie) =>
          cookie.startsWith(`${scopedName}=`),
        );
        if (!scoped) throw new Error(`Missing ${scopedName} cookie`);
        expect(scoped).toContain(
          `Path=${resourceCookiePath(launchCourse.id, question.id)}`,
        );
        expect(
          cookies.some(
            (cookie) =>
              cookie.startsWith('lti_auth_token=') &&
              !cookie.startsWith('lti_auth_token=;'),
          ),
        ).toBe(false);

        const cookieValue = scoped.split(';')[0].slice(scopedName.length + 1);
        const jwtService = getTestModule().get<JwtService>(JwtService);
        const decoded = jwtService.verify<Record<string, unknown>>(cookieValue);
        expect(decoded).toMatchObject({
          kind: 'embeddable-resource',
          role: 'learner',
          iss: 'https://canvas.example.edu',
          sub: 'canvas-learner-1',
          courseId: launchCourse.id,
          questionId: question.id,
        });
        expect(decoded).not.toHaveProperty('email');
        expect(decoded).not.toHaveProperty('userId');
        const exp = decoded['exp'];
        const iat = decoded['iat'];
        expect(typeof exp).toBe('number');
        expect(typeof iat).toBe('number');
        if (typeof exp === 'number' && typeof iat === 'number') {
          expect(exp - iat).toBe(EMBEDDABLE_RESOURCE_TTL_SECONDS);
        }

        await supertest()
          .get(`/lti/embeddable-resource/${launchCourse.id}/${question.id}`)
          .set('Cookie', [`${scopedName}=${cookieValue}`])
          .expect(200);

        await expect(tableCounts()).resolves.toEqual(before);
      });

      it('issues distinct cookie names for two questions in one quiz', async () => {
        const { launchCourse, question: q1 } = await setupQuestionLaunch();
        const q2 = await EmbeddableQuestionModel.create({
          courseId: launchCourse.id,
          questionText: 'Second question',
          criteriaText: 'Criteria text',
        }).save();

        const first = await supertest().get('/lti').expect(302);
        if (!customToken || !customToken.platformContext?.custom) {
          throw new Error('Missing custom token');
        }
        customToken.platformContext.custom['helpme_question_id'] = String(
          q2.id,
        );
        const second = await supertest().get('/lti').expect(302);

        const firstName = (first.get('Set-Cookie') ?? []).find((cookie) =>
          cookie.startsWith('lti_resource_'),
        );
        const secondName = (second.get('Set-Cookie') ?? []).find((cookie) =>
          cookie.startsWith('lti_resource_'),
        );
        expect(firstName).toBeDefined();
        expect(secondName).toBeDefined();
        expect(firstName!.split('=')[0]).not.toBe(secondName!.split('=')[0]);
      });

      it('should fail with 403 and write nothing when LTI token is absent', async () => {
        const before = await tableCounts();
        customToken = null;

        await supertest().get('/lti').expect(403);

        await expect(tableCounts()).resolves.toEqual(before);
      });

      it('should launch an existing instructor preview with a staff resource cookie and no writes', async () => {
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
        const before = await tableCounts();

        const response = await supertest().get('/lti').expect(302);
        const location = new URL(
          'https://example.com' + response.headers['location'],
        );
        expect(location.pathname).toEqual(
          `/lti/embeddable/${launchCourse.id}/question/${question.id}`,
        );
        expect(location.searchParams.get('resource')).toEqual('1');

        const scopedName = resourceCookieName(launchCourse.id, question.id);
        const scoped = (response.get('Set-Cookie') ?? []).find((cookie) =>
          cookie.startsWith(`${scopedName}=`),
        );
        if (!scoped) throw new Error(`Missing ${scopedName} cookie`);
        const cookieValue = scoped.split(';')[0].slice(scopedName.length + 1);
        const jwtService = getTestModule().get<JwtService>(JwtService);
        const decoded = jwtService.verify<Record<string, unknown>>(cookieValue);
        expect(decoded).toMatchObject({
          kind: 'embeddable-resource',
          role: 'staff',
          iss: 'https://canvas.example.edu',
          sub: 'canvas-learner-1',
          courseId: launchCourse.id,
          questionId: question.id,
          userId: instructor.id,
        });
        expect(decoded).not.toHaveProperty('email');

        await supertest()
          .get(`/lti/embeddable-resource/${launchCourse.id}/${question.id}`)
          .set('Cookie', [`${scopedName}=${cookieValue}`])
          .expect(200);

        await expect(tableCounts()).resolves.toEqual(before);
      });

      it('should not provision an unknown instructor question launch', async () => {
        await setupQuestionLaunch([
          'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
        ]);
        const before = await tableCounts();

        await supertest().get('/lti').expect(403);
        await expect(tableCounts()).resolves.toEqual(before);
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
