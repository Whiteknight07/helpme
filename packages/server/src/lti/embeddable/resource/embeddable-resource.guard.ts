import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  EmbeddableResourceRequest,
  parseResourcePayload,
  resourceCookieName,
} from './embeddable-resource-auth';

@Injectable()
export class EmbeddableResourceGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<EmbeddableResourceRequest>();
    const courseId = Number(req.params?.courseId);
    const questionId = Number(req.params?.questionId);
    if (
      !Number.isSafeInteger(courseId) ||
      courseId <= 0 ||
      !Number.isSafeInteger(questionId) ||
      questionId <= 0
    ) {
      throw new BadRequestException();
    }

    const token: unknown =
      req.cookies?.[resourceCookieName(courseId, questionId)];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException();
    }

    let verified: unknown;
    try {
      verified = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }

    const payload = parseResourcePayload(verified);
    if (!payload) {
      throw new UnauthorizedException();
    }
    if (payload.courseId !== courseId || payload.questionId !== questionId) {
      throw new ForbiddenException();
    }

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (
        typeof origin !== 'string' ||
        origin === 'null' ||
        typeof host !== 'string'
      ) {
        throw new ForbiddenException();
      }
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new ForbiddenException();
      }
      if (originHost !== host) {
        throw new ForbiddenException();
      }
    }

    req.resourceAuth = payload;
    return true;
  }
}
