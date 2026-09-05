import { UnauthorizedException } from '@nestjs/common';

export const APP_AUTH_KIND = 'app-auth' as const;

export function getAppAuthUserId(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) {
    throw new UnauthorizedException();
  }

  const { kind, userId, iat, expiresIn } = payload as {
    kind?: unknown;
    userId?: unknown;
    iat?: unknown;
    expiresIn?: unknown;
  };
  if (
    (kind !== undefined && kind !== APP_AUTH_KIND) ||
    typeof userId !== 'number' ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    throw new UnauthorizedException();
  }

  if (
    kind === undefined &&
    typeof iat === 'number' &&
    typeof expiresIn === 'number' &&
    iat + expiresIn <= Date.now() / 1000
  ) {
    throw new UnauthorizedException();
  }

  return userId;
}
