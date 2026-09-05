import { UnauthorizedException } from '@nestjs/common';
import { APP_AUTH_KIND, getAppAuthUserId } from './auth-token';

describe('app JWT payload validation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['legacy app token', { userId: 7 }],
    ['purpose-tagged app token', { kind: APP_AUTH_KIND, userId: 7 }],
  ])('accepts a valid %s', (_, payload) => {
    expect(getAppAuthUserId(payload)).toBe(7);
  });

  it.each([
    ['resource token', { kind: 'embeddable-resource', userId: 7 }],
    ['missing user id', { kind: APP_AUTH_KIND }],
    ['zero user id', { kind: APP_AUTH_KIND, userId: 0 }],
    ['fractional user id', { kind: APP_AUTH_KIND, userId: 1.5 }],
    ['string user id', { kind: APP_AUTH_KIND, userId: '7' }],
  ])('rejects %s', (_, payload) => {
    expect(() => getAppAuthUserId(payload)).toThrow(UnauthorizedException);
  });

  it('rejects an expired legacy application session', () => {
    jest.spyOn(Date, 'now').mockReturnValue(200_000);

    expect(() =>
      getAppAuthUserId({ userId: 7, iat: 100, expiresIn: 60 }),
    ).toThrow(UnauthorizedException);
  });
});
