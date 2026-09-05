import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserCourseModel } from '../../../profile/user-course.entity';
import { EmbeddableResourceGuard } from './embeddable-resource.guard';
import {
  EMBEDDABLE_RESOURCE_KIND,
  resourceCookieName,
} from './embeddable-resource-auth';

function contextFor(request: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('EmbeddableResourceGuard', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const guard = new EmbeddableResourceGuard(
    jwtService,
    new ConfigService({ DOMAIN: 'https://helpme.test' }),
  );

  afterEach(() => jest.restoreAllMocks());

  const learnerToken = () =>
    jwtService.sign(
      {
        kind: EMBEDDABLE_RESOURCE_KIND,
        role: 'learner',
        ltiIssuer: 'https://canvas.example.edu',
        ltiSubject: 'student-1',
        courseId: 1,
        questionId: 2,
      },
      { expiresIn: 3600 },
    );

  it('accepts a same-origin feedback POST', async () => {
    const request: Record<string, any> = {
      params: { courseId: '1', questionId: '2' },
      cookies: { [resourceCookieName(1, 2)]: learnerToken() },
      method: 'POST',
      headers: { host: 'helpme.test', origin: 'https://helpme.test' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.resourceAuth).toMatchObject({
      role: 'learner',
      courseId: 1,
      questionId: 2,
    });
  });

  it('rejects the same host on HTTP when production requires HTTPS', async () => {
    const request = {
      params: { courseId: '1', questionId: '2' },
      cookies: { [resourceCookieName(1, 2)]: learnerToken() },
      method: 'POST',
      headers: { host: 'helpme.test', origin: 'http://helpme.test' },
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rechecks staff enrollment on later resource requests', async () => {
    jest.spyOn(UserCourseModel, 'findOne').mockResolvedValue(null);
    const token = jwtService.sign(
      {
        kind: EMBEDDABLE_RESOURCE_KIND,
        role: 'staff',
        ltiIssuer: 'https://canvas.example.edu',
        ltiSubject: 'staff-1',
        courseId: 1,
        questionId: 2,
        userId: 9,
      },
      { expiresIn: 3600 },
    );
    const request = {
      params: { courseId: '1', questionId: '2' },
      cookies: { [resourceCookieName(1, 2)]: token },
      method: 'GET',
      headers: {},
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
