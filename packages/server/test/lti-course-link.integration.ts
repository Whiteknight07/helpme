import { JwtService } from '@nestjs/jwt';
import { APP_AUTH_KIND } from '../src/login/auth-token';
import { LtiModule } from '../src/lti/lti.module';
import { LMSCourseIntegrationModel } from '../src/lmsIntegration/lmsCourseIntegration.entity';
import { LMSOrganizationIntegrationModel } from '../src/lmsIntegration/lmsOrgIntegration.entity';
import { LMSIntegrationPlatform, Role } from '@koh/common';
import {
  CourseFactory,
  OrganizationCourseFactory,
  OrganizationFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import { setupIntegrationTest } from './util/testUtils';

describe('LTI course linking', () => {
  const { supertest, getTestModule } = setupIntegrationTest(LtiModule);

  const setupProfessor = async (withOrgIntegration = true) => {
    const organization = await OrganizationFactory.create();
    const course = await CourseFactory.create();
    const user = await UserFactory.create();
    await OrganizationCourseFactory.create({ course, organization });
    await UserCourseFactory.create({ user, course, role: Role.PROFESSOR });
    if (withOrgIntegration) {
      await LMSOrganizationIntegrationModel.create({
        organizationId: organization.id,
        apiPlatform: LMSIntegrationPlatform.Canvas,
        rootUrl: 'canvas.example.edu',
        secure: true,
      }).save();
    }
    return { course, user };
  };

  const signLtiSession = (
    userId: number,
    apiCourseId = 'canvas-course-44',
  ) =>
    getTestModule().get<JwtService>(JwtService).sign({
      kind: APP_AUTH_KIND,
      userId,
      custom: {
        ltiApiCourseId: apiCourseId,
        ltiPlatform: LMSIntegrationPlatform.Canvas,
      },
    });

  const body = {
    apiPlatform: LMSIntegrationPlatform.Canvas,
    apiCourseId: 'canvas-course-44',
  };

  it('rejects a normal HelpMe session without verified LTI context', async () => {
    const { course, user } = await setupProfessor();

    await supertest({ userId: user.id })
      .post(`/lms/course/${course.id}/link`)
      .set('Host', 'helpme.test')
      .set('Origin', 'http://helpme.test')
      .send(body)
      .expect(401);
  });

  it('rejects a browser-edited Canvas course ID', async () => {
    const { course, user } = await setupProfessor();

    await supertest()
      .post(`/lms/course/${course.id}/link`)
      .set('Host', 'helpme.test')
      .set('Origin', 'http://helpme.test')
      .set('Cookie', [`lti_auth_token=${signLtiSession(user.id)}`])
      .send({ ...body, apiCourseId: 'attacker-selected-course' })
      .expect(403);

    expect(
      await LMSCourseIntegrationModel.findOne({
        where: { courseId: course.id },
      }),
    ).toBeNull();
  });

  it('requires the existing organization Canvas integration', async () => {
    const { course, user } = await setupProfessor(false);

    await supertest()
      .post(`/lms/course/${course.id}/link`)
      .set('Host', 'helpme.test')
      .set('Origin', 'http://helpme.test')
      .set('Cookie', [`lti_auth_token=${signLtiSession(user.id)}`])
      .send(body)
      .expect(404);

    expect(
      await LMSCourseIntegrationModel.findOne({
        where: { courseId: course.id },
      }),
    ).toBeNull();
  });

  it('uses the LTI session even when a normal auth cookie also exists', async () => {
    const { course, user } = await setupProfessor();
    const jwtService = getTestModule().get<JwtService>(JwtService);
    const authToken = jwtService.sign({ kind: APP_AUTH_KIND, userId: user.id });
    const ltiToken = signLtiSession(user.id);

    await supertest()
      .post(`/lms/course/${course.id}/link`)
      .set('Host', 'helpme.test')
      .set('Origin', 'http://helpme.test')
      .set('Cookie', [
        `auth_token=${authToken}`,
        `lti_auth_token=${ltiToken}`,
      ])
      .send(body)
      .expect(201);

    await expect(
      LMSCourseIntegrationModel.findOne({
        where: { courseId: course.id },
        relations: { orgIntegration: true },
      }),
    ).resolves.toMatchObject({
      courseId: course.id,
      apiCourseId: body.apiCourseId,
      orgIntegration: { apiPlatform: LMSIntegrationPlatform.Canvas },
    });
  });
});
