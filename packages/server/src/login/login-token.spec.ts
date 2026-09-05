import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { APP_AUTH_KIND } from './auth-token';
import { LoginService } from './login.service';

describe('LoginService auth token lifetime', () => {
  it('adds a standard JWT expiry while keeping the existing expiresIn payload', async () => {
    const jwtService = new JwtService({ secret: 'test-secret' });
    const service = new LoginService(
      jwtService,
      new ConfigService({ DOMAIN: 'http://localhost' }),
      {} as any,
    );

    const token = await service.generateAuthToken(7, 60);
    const payload = jwtService.verify<{
      kind: string;
      expiresIn: number;
      iat: number;
      exp: number;
    }>(token);

    expect(payload.kind).toBe(APP_AUTH_KIND);
    expect(payload.expiresIn).toBe(60);
    expect(payload.exp - payload.iat).toBe(60);
  });
});
