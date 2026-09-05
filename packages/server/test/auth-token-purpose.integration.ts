import { JwtService } from '@nestjs/jwt';
import { Role } from '@koh/common';
import { LtiModule } from '../src/lti/lti.module';
import { LOGIN_ENTRY_KIND } from '../src/login/auth-token';
import {
  CourseFactory,
  UserCourseFactory,
  UserFactory,
} from './util/factories';
import { setupIntegrationTest } from './util/testUtils';

describe('JWT purpose isolation', () => {
  const { supertest, getTestModule } = setupIntegrationTest(LtiModule);

  it('does not accept a login-entry credential as an application session', async () => {
    const user = await UserFactory.create();
    const course = await CourseFactory.create();
    await UserCourseFactory.create({ user, course, role: Role.PROFESSOR });

    const loginEntryToken = getTestModule().get<JwtService>(JwtService).sign(
      {
        kind: LOGIN_ENTRY_KIND,
        userId: user.id,
      },
      { expiresIn: 60 },
    );

    await supertest()
      .get(`/lti/embeddable-question/${course.id}`)
      .set('Cookie', [`auth_token=${loginEntryToken}`])
      .expect(401);
  });
});
