import { JwtService } from '@nestjs/jwt';
import { Role } from '@koh/common';
import { LtiModule } from '../src/lti/lti.module';
import { EMBEDDABLE_RESOURCE_TTL_SECONDS } from '../src/lti/embeddable/resource/embeddable-resource-auth';
import {
  CourseFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import { setupIntegrationTest } from './util/testUtils';

describe('JWT purpose isolation', () => {
  const { supertest, getTestModule } = setupIntegrationTest(LtiModule);

  it('rejects a question resource token as a normal HelpMe session', async () => {
    const user = await UserFactory.create();
    const course = await CourseFactory.create();
    await UserCourseFactory.create({ user, course, role: Role.PROFESSOR });

    const jwtService = getTestModule().get<JwtService>(JwtService);
    const resourceToken = jwtService.sign(
      {
        kind: 'embeddable-resource',
        role: 'staff',
        ltiIssuer: 'https://canvas.example.edu',
        ltiSubject: 'staff-user',
        courseId: course.id,
        questionId: 1,
        userId: user.id,
      },
      { expiresIn: EMBEDDABLE_RESOURCE_TTL_SECONDS },
    );

    await supertest()
      .get(`/lti/embeddable-question/${course.id}`)
      .set('Cookie', [`auth_token=${resourceToken}`])
      .expect(401);
  });
});
