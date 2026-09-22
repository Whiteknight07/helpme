import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { LMSCourseIntegrationModel } from './lmsCourseIntegration.entity';
import {
  ERROR_MESSAGES,
  LMSAnnouncement,
  LMSApiResponseStatus,
  LMSAssignment,
  LMSCourseAPIResponse,
  LMSFile,
  LMSIntegrationPlatform,
  LMSPage,
  LMSPostAuthBody,
  LMSPostResponseRefreshTokenBody,
  LMSQuiz,
} from '@koh/common';
import { LMSUpload } from './lmsIntegration.service';
import { Cache } from 'cache-manager';
import { LMSOrganizationIntegrationModel } from './lmsOrgIntegration.entity';
import { LMSAuthStateModel } from './lms-auth-state.entity';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import { LMSAccessToken, LMSAccessTokenModel } from './lms-access-token.entity';
import * as crypto from 'crypto';
import { convert } from 'html-to-text';
import { load } from 'cheerio';
import { validate as isUuid } from 'uuid';

/**
 * Narrow transport types for Canvas Classic batch grading.
 *
 * These describe the only data the batch grading runtime consumes. Canvas JSON
 * is untrusted: every field is validated before it is placed in one of these
 * shapes, and anything that does not validate is reported as unreadable rather
 * than being coerced into a blank value.
 */

/** Identifies a Classic quiz together with the assignment it grades. */
export interface LMSClassicQuizRef {
  quizId: number;
  assignmentId: number;
}

/** Identifies one Classic quiz attempt belonging to a single student. */
export interface LMSClassicAttemptRef extends LMSClassicQuizRef {
  userId: number;
  attempt?: number;
}

/** An essay question of a Classic quiz. */
export type LMSClassicQuestionMapping =
  | {
      status: 'detected';
      lookupUuid: string;
      embeddableQuestionId: number;
    }
  | { status: 'error'; message: string };

export interface LMSClassicQuizQuestion {
  id: number;
  position: number;
  text: string;
  points: number;
  mapping: LMSClassicQuestionMapping;
}

/** A published Classic quiz that is eligible for batch grading. */
export interface LMSClassicQuiz {
  quizId: number;
  title: string;
  assignmentId: number;
  postManually: boolean;
  speedGraderUrl: string;
  essayQuestions: LMSClassicQuizQuestion[];
}

export interface LMSClassicQuizCatalogResult {
  status: LMSApiResponseStatus;
  quizzes: LMSClassicQuiz[];
}

/** One completed answer of an attempt, read from submission history. */
export interface LMSClassicAttemptAnswer {
  questionId: number;
  /** Submitted essay text with block breaks and entities preserved. */
  text: string;
  /** Existing score for this answer, or null when it is not graded. */
  points: number | null;
  /** Existing grader comment for this answer, or null. */
  comment: string | null;
}

export interface LMSClassicAttempt {
  quizSubmissionId: number;
  userId: number;
  attempt: number;
  postedAt: string | null;
  excused: boolean;
  /**
   * False when Canvas did not provide usable submission history for this
   * attempt. Unreadable attempts carry no answers and must not be treated as
   * blank submissions.
   */
  readable: boolean;
  answers: LMSClassicAttemptAnswer[];
}

export interface LMSClassicAttemptSnapshot {
  quizId: number;
  attempts: LMSClassicAttempt[];
}

export interface LMSClassicAttemptSnapshotResult {
  status: LMSApiResponseStatus;
  snapshot?: LMSClassicAttemptSnapshot;
}

/** One question's score and comment inside a multi-question attempt write. */
export interface LMSClassicQuestionGrade {
  questionId: number;
  score: number;
  comment: string;
}

/**
 * Score and comment writes for every safe question of one completed attempt.
 * Canvas receives them in a single request, and an aggregate total can never
 * be moved.
 */
export interface LMSClassicAttemptGradesUpdate {
  quizId: number;
  quizSubmissionId: number;
  /** Required by Canvas: the completed attempt being updated. */
  attempt: number;
  questions: LMSClassicQuestionGrade[];
}

/**
 * Result of a Canvas write request.
 *
 * - `success`     the write was accepted.
 * - `rejected`    Canvas answered with a non-2xx status, or the request could
 *                 not be attempted (e.g. missing authorization). The write
 *                 definitely did not happen and must not be retried blindly.
 * - `unknown`     the request was sent but the transport failed (timeout,
 *                 socket error, abort). The write may or may not have been
 *                 applied.
 * - `unsupported` the active adapter does not implement the operation.
 */
export type LMSWriteOutcome =
  'success' | 'rejected' | 'unknown' | 'unsupported';

export interface LMSWriteResult {
  outcome: LMSWriteOutcome;
  httpStatus?: number;
  message?: string;
}

/** Bound Canvas requests; a timed-out write has an unknown outcome. */
const CANVAS_REQUEST_TIMEOUT_MS = 30000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Ids are read strictly, tolerating Canvas' occasional numeric strings. */
function asId(value: unknown): number | null {
  const direct = asNumber(value);
  if (direct !== null) return direct;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Convert submitted essay HTML into plain text.
 *
 * `html-to-text` preserves block level markup as line breaks and decodes HTML
 * entities. A submission that is only whitespace (including `&nbsp;`)
 * normalises to the empty string so callers can tell a blank answer apart from
 * unreadable data.
 */
export function htmlToEssayText(html: unknown): string {
  if (typeof html !== 'string') return '';
  const text = convert(html, { wordwrap: false }).replace(/\u00a0/g, ' ');
  return text.trim().length === 0 ? '' : text;
}

/** Lookup UUIDs Canvas places in LTI resource-link iframe URLs. */
export function resourceLinkLookupUuids(html: unknown): string[] {
  if (typeof html !== 'string') return [];
  const uuids = new Set<string>();
  const $ = load(html);
  $('iframe[src]').each((_, iframe) => {
    const src = $(iframe).attr('src');
    if (!src) return;
    try {
      const uuid = new URL(src, 'https://canvas.invalid').searchParams.get(
        'resource_link_lookup_uuid',
      );
      if (uuid && isUuid(uuid)) {
        uuids.add(uuid.toLowerCase());
      }
    } catch {
      // Invalid iframe URLs cannot identify a Canvas resource link.
    }
  });
  return [...uuids];
}

@Injectable()
export class LMSIntegrationAdapter {
  async getAdapter(
    integration: LMSCourseIntegrationModel,
    cacheManager?: Cache,
  ) {
    switch (integration.orgIntegration.apiPlatform) {
      case 'Canvas':
        return new CanvasLMSAdapter(integration, cacheManager);
    }
    return new BaseLMSAdapter(integration, cacheManager);
  }
}

export abstract class AbstractLMSAdapter {
  protected refreshTokenUrl: string;

  /* eslint-disable @typescript-eslint/no-unused-vars */
  constructor(
    protected integration: LMSCourseIntegrationModel,
    protected cacheManager?: Cache,
  ) {}

  static async createState(
    organizationIntegration: LMSOrganizationIntegrationModel,
    userId: number,
    redirectUrl?: string,
  ): Promise<LMSAuthStateModel> {
    let state: string;
    do {
      state = encodeURIComponent(crypto.randomBytes(25).toString('hex'));
    } while (await LMSAuthStateModel.findOne({ where: { state } }));

    return await LMSAuthStateModel.save({
      state,
      organizationIntegration,
      userId,
      redirectUrl,
    });
  }

  static async logoutAuth(accessToken: LMSAccessTokenModel): Promise<boolean> {
    const adapter = new LMSIntegrationAdapter();
    const lmsAdapter = await adapter.getAdapter({
      accessTokenId: accessToken.id,
      accessToken: accessToken,
      orgIntegration: accessToken.organizationIntegration,
    } as unknown as LMSCourseIntegrationModel);

    return await lmsAdapter.logoutAuth();
  }

  async logoutAuth(): Promise<boolean> {
    return null;
  }

  static async redirectAuth(
    response: express.Response,
    organizationIntegration: LMSOrganizationIntegrationModel,
    userId: number,
    configService: ConfigService,
    redirectUrl?: string,
  ): Promise<any> {
    switch (organizationIntegration.apiPlatform) {
      case 'Canvas':
        return CanvasLMSAdapter.redirectAuth(
          response,
          organizationIntegration,
          userId,
          configService,
          redirectUrl,
        );
    }
    return null;
  }

  static async postAuth(
    authBody: LMSPostAuthBody,
    organizationIntegration: LMSOrganizationIntegrationModel,
  ) {
    switch (organizationIntegration.apiPlatform) {
      case 'Canvas':
        return CanvasLMSAdapter.postAuth(authBody, organizationIntegration);
    }
    return null;
  }

  static async getUserCourses(accessToken: LMSAccessTokenModel): Promise<{
    status: LMSApiResponseStatus;
    courses: LMSCourseAPIResponse[];
  }> {
    const adapter = new LMSIntegrationAdapter();
    const lmsAdapter = await adapter.getAdapter({
      accessTokenId: accessToken.id,
      accessToken: accessToken,
      orgIntegration: accessToken.organizationIntegration,
    } as unknown as LMSCourseIntegrationModel);

    return await lmsAdapter.getUserCourses();
  }

  async checkAccessToken(id: number): Promise<{
    accessToken: LMSAccessTokenModel;
    token: LMSAccessToken;
  }> {
    const accessToken = await LMSAccessTokenModel.findOne({
      where: {
        id: id,
      },
      relations: {
        organizationIntegration: true,
      },
    });
    if (!accessToken) {
      throw new BadRequestException(
        ERROR_MESSAGES.lmsAdapter.missingAccessToken,
      );
    }

    const token = await accessToken.getToken();

    if (accessToken.isExpired(token)) {
      const response = await fetch(this.refreshTokenUrl, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: accessToken.organizationIntegration.clientId,
          client_secret: accessToken.organizationIntegration.clientSecret,
          refresh_token: token.refresh_token,
        } as unknown as Record<string, string>).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new HttpException(
          `${err.error}: ${err.error_description}`,
          response.status,
        );
      }

      const raw = (await response.json()) as LMSPostResponseRefreshTokenBody;
      const updated = await accessToken.encryptToken({
        ...token, // old token
        ...raw, // new token attributes (just in case anything changed. Also RefreshTokenBody is a subset of the regular POST body)
        refresh_token: token.refresh_token, // just to be explicit: we must RE-USE existing refresh token according to canvas api docs https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints#post-login-oauth2-token
      });

      return {
        accessToken: updated,
        token: await updated.getToken(),
      };
    }

    return {
      accessToken,
      token,
    };
  }

  async getAuthorization() {
    // const orgSettings = await OrganizationSettingsModel.findOne({
    //   where: {
    //     organizationId: this.integration.orgIntegration.organizationId,
    //   },
    // });
    // TODO: TEMPORARY: Allow API Keys through even if organization settings disallows adding them
    if (this.integration.apiKey != undefined) {
      // && orgSettings?.allowLMSApiKey) {
      if (
        this.integration.apiKeyExpiry &&
        this.integration.apiKeyExpiry.getTime() < Date.now()
      ) {
        throw new BadRequestException(
          ERROR_MESSAGES.lmsController.apiKeyExpired,
        );
      }
      return `Bearer ${this.integration.apiKey}`;
    }

    if (!this.integration.accessTokenId) {
      throw new BadRequestException(
        ERROR_MESSAGES.lmsAdapter.missingAccessToken,
      );
    }

    const { token } = await this.checkAccessToken(
      this.integration.accessTokenId,
    );
    return `${token.token_type} ${token.access_token}`;
  }

  getPlatform(): LMSIntegrationPlatform | null {
    return null;
  }

  isImplemented(): boolean {
    return false;
  }

  async Get(
    url: string,
  ): Promise<{ status: LMSApiResponseStatus; data?: any; nextLink?: string }> {
    return null;
  }

  async getUserCourses(): Promise<{
    status: LMSApiResponseStatus;
    courses: LMSCourseAPIResponse[];
  }> {
    return null;
  }

  async getCourse(): Promise<{
    status: LMSApiResponseStatus;
    course: LMSCourseAPIResponse;
  }> {
    return null;
  }

  async getStudents(): Promise<{
    status: LMSApiResponseStatus;
    students: string[];
  }> {
    return null;
  }

  async getAnnouncements(): Promise<{
    status: LMSApiResponseStatus;
    announcements: LMSAnnouncement[];
  }> {
    return null;
  }

  async getAssignments(): Promise<{
    status: LMSApiResponseStatus;
    assignments: LMSAssignment[];
  }> {
    return null;
  }

  async getPages(): Promise<{
    status: LMSApiResponseStatus;
    pages: LMSPage[];
  }> {
    return null;
  }

  async getFiles(): Promise<{
    status: LMSApiResponseStatus;
    files: LMSFile[];
  }> {
    return null;
  }

  async getQuizzes(): Promise<{
    status: LMSApiResponseStatus;
    quizzes: LMSQuiz[];
  }> {
    return null;
  }

  /**
   * Published Classic quizzes eligible for batch grading, with their essay
   * questions. Unsupported platforms report the platform as invalid.
   */
  async getClassicQuizCatalog(
    quizId?: number,
  ): Promise<LMSClassicQuizCatalogResult> {
    return { status: LMSApiResponseStatus.InvalidPlatform, quizzes: [] };
  }

  /**
   * Completed attempt snapshots for every student of a Classic quiz.
   */
  async getClassicAttemptSnapshots(
    params: LMSClassicQuizRef,
  ): Promise<LMSClassicAttemptSnapshotResult> {
    return { status: LMSApiResponseStatus.InvalidPlatform };
  }

  /**
   * A fresh, uncached snapshot of one student's attempt, used for preflight
   * checks.
   */
  async getClassicAttemptSnapshot(
    params: LMSClassicAttemptRef,
  ): Promise<LMSClassicAttemptSnapshotResult> {
    return { status: LMSApiResponseStatus.InvalidPlatform };
  }

  /** Write the score and comment for every safe question of one attempt. */
  async putClassicAttemptGrades(
    params: LMSClassicAttemptGradesUpdate,
  ): Promise<LMSWriteResult> {
    return {
      outcome: 'unsupported',
      message: 'Classic quiz grading is not supported by this LMS platform.',
    };
  }

  getDocumentLink(documentId: number, documentType: LMSUpload): string {
    switch (documentType) {
      default:
        return '';
    }
  }
}

abstract class ImplementedLMSAdapter extends AbstractLMSAdapter {
  isImplemented(): boolean {
    return true;
  }
}

export class BaseLMSAdapter extends AbstractLMSAdapter {}

/**
 * OAuth scopes requested when a Canvas integration is created.
 *
 * The scopes at the end support Classic batch grading and automatic embed
 * detection; everything above them is used by document sync.
 */
export const CANVAS_OAUTH_SCOPES: readonly string[] = [
  'url:GET|/api/v1/users/:user_id/courses',
  'url:GET|/api/v1/courses/:id',
  'url:GET|/api/v1/courses/:course_id/assignments',
  'url:GET|/api/v1/courses/:course_id/users',
  'url:GET|/api/v1/courses/:course_id/enrollments',
  'url:GET|/api/v1/courses/:course_id/discussion_topics',
  'url:GET|/api/v1/courses/:course_id/pages',
  'url:GET|/api/v1/courses/:course_id/pages/:url_or_id',
  'url:GET|/api/v1/courses/:course_id/files',
  'url:GET|/api/v1/courses/:course_id/quizzes',
  'url:GET|/api/v1/courses/:course_id/quizzes/:quiz_id/questions',
  'url:GET|/api/v1/courses/:course_id/lti_resource_links/:id',
  'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
  'url:GET|/api/v1/courses/:course_id/quizzes/:quiz_id/submissions',
  'url:PUT|/api/v1/courses/:course_id/quizzes/:quiz_id/submissions/:id',
];

export class CanvasLMSAdapter extends ImplementedLMSAdapter {
  constructor(
    protected integration: LMSCourseIntegrationModel,
    protected cacheManager?: Cache,
  ) {
    super(integration, cacheManager);
    this.refreshTokenUrl = `${this.integration.orgIntegration.secure ? 'https' : 'http'}://${this.integration.orgIntegration.rootUrl}/login/oauth2/token`;
  }

  getPlatform(): LMSIntegrationPlatform {
    return LMSIntegrationPlatform.Canvas;
  }

  async logoutAuth(): Promise<boolean> {
    const uri = `${this.integration.orgIntegration.secure ? 'https' : 'http'}://${this.integration.orgIntegration.rootUrl}/login/oauth2/token`;

    let alreadyInvalid = false;
    await this.checkAccessToken(this.integration.accessTokenId).catch((err) => {
      if ((err as Error).message == `invalid_grant: refresh_token not found`) {
        alreadyInvalid = true;
      }
    });
    if (alreadyInvalid) return true;

    return await fetch(uri, {
      method: 'DELETE',
      headers: {
        Authorization: await this.getAuthorization(),
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status != 500) {
            const json = await res.json();
            throw new HttpException(`${json.error}`, res.status);
          } else {
            throw new HttpException('Fetch failed', 500);
          }
        }
        console.log('Successfully invalidated token!');
        return true;
      })
      .catch((err) => {
        console.error(
          `Could not invalidate token. Error: ${(err as Error).message}`,
        );
        return false;
      });
  }

  static async redirectAuth(
    response: express.Response,
    organizationIntegration: LMSOrganizationIntegrationModel,
    userId: number,
    configService: ConfigService,
    redirectUrl?: string,
  ) {
    const uri = `${organizationIntegration.secure ? 'https' : 'http'}://${organizationIntegration.rootUrl}/login/oauth2/auth`;

    const state = await super.createState(
      organizationIntegration,
      userId,
      redirectUrl,
    );

    const query = new URLSearchParams({
      client_id: organizationIntegration.clientId,
      response_type: 'code',
      state: state.state,
      scope: CANVAS_OAUTH_SCOPES.join(' '),
      redirect_uri: `${configService.get<string>('DOMAIN')}/api/v1/lms/oauth2/response`,
    });

    const url = `${uri}?${query.toString()}`;
    return response.redirect(url);
  }

  static async postAuth(
    authBody: LMSPostAuthBody,
    organizationIntegration: LMSOrganizationIntegrationModel,
  ) {
    const uri = `${organizationIntegration.secure ? 'https' : 'http'}://${organizationIntegration.rootUrl}/login/oauth2/token`;

    return await fetch(uri, {
      method: 'POST',
      body: new URLSearchParams(
        authBody as unknown as Record<string, string>,
      ).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
      .then(async (res) => {
        if (res.ok) return res;
        else {
          throw await res.json().then((json) => {
            return new HttpException(
              `${json.error}: ${json.error_description}`,
              res.status,
            );
          });
        }
      })
      .catch((err) => {
        throw err;
      });
  }

  async Get(
    path: string,
  ): Promise<{ status: LMSApiResponseStatus; data?: any; nextLink?: string }> {
    const url = `${this.canvasBaseUrl()}/api/v1/${path}`;
    const cacheKey = url;

    // Check cache first
    if (this.cacheManager) {
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        return cached as {
          status: LMSApiResponseStatus;
          data?: any;
          nextLink?: string;
        };
      }
    }

    const result = await this.requestGet(path);

    // Cache successful results for 5 minutes
    if (this.cacheManager && result.status === LMSApiResponseStatus.Success) {
      await this.cacheManager.set(cacheKey, result, 300000);
    }

    return result;
  }

  private canvasBaseUrl(): string {
    return `${this.integration.orgIntegration.secure ? 'https' : 'http'}://${this.integration.orgIntegration.rootUrl}`;
  }

  /**
   * Issue a Canvas GET without touching the cache.
   *
   * Used by the Classic batch grading transport, which must always observe the
   * live state of submissions instead of a cached document sync response.
   */
  private async requestGet(path: string): Promise<{
    status: LMSApiResponseStatus;
    data?: unknown;
    nextLink?: string;
  }> {
    const url = `${this.canvasBaseUrl()}/api/v1/${path}`;

    return fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(CANVAS_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: await this.getAuthorization(),
      },
    })
      .then((response) => {
        const nextLink = this.parseNextLink(response.headers.get('link'));
        if (!response.ok) {
          switch (response.status) {
            case 401:
              return { status: LMSApiResponseStatus.Unauthorized };
            case 403:
              return { status: LMSApiResponseStatus.Forbidden };
            case 404:
              return { status: LMSApiResponseStatus.InvalidCourseId };
            default:
              throw new Error();
          }
        } else {
          return response.json().then((data: unknown) => {
            return { status: LMSApiResponseStatus.Success, data, nextLink };
          });
        }
      })
      .catch((error) => {
        console.log(
          `Error contacting ${this.integration.orgIntegration.rootUrl}: ${error}`,
        );
        return { status: LMSApiResponseStatus.Error };
      });
  }

  /** Extract the `next` pagination path from a Canvas `Link` header. */
  private parseNextLink(linkHeader: string | null): string | undefined {
    if (!linkHeader) return undefined;

    const links = linkHeader.split(/(?<=rel="[^"]*")/);
    let nextLink = links.find((s) => s.includes('rel="next"'));
    if (nextLink != undefined) {
      nextLink = nextLink.substring(
        nextLink.indexOf('/api/v1/') + '/api/v1/'.length,
        nextLink.indexOf('>'),
      );
    }
    return nextLink;
  }

  /**
   * Paginate a Canvas list endpoint without caching.
   *
   * Handles both plain array responses and object-wrapped lists such as
   * `{ quiz_submissions: [...] }`. `malformed` is true when a page answered
   * successfully with a payload that is neither, so callers can fail closed
   * instead of treating it as an empty page.
   */
  private async GetPaginatedUncached(
    initialPath: string,
    wrapKey?: string,
  ): Promise<{
    status: LMSApiResponseStatus;
    items: unknown[];
    malformed: boolean;
  }> {
    const items: unknown[] = [];
    let nextLink =
      initialPath.indexOf('?') != -1
        ? `${initialPath}&per_page=50`
        : `${initialPath}?per_page=50`;

    while (nextLink !== undefined) {
      const res = await this.requestGet(nextLink);
      if (res.status != LMSApiResponseStatus.Success) {
        return { status: res.status, items: [], malformed: false };
      }

      const page = this.extractList(res.data, wrapKey);
      if (page === null) {
        return {
          status: LMSApiResponseStatus.Success,
          items,
          malformed: true,
        };
      }

      items.push(...page);
      nextLink = res.nextLink;
    }

    return { status: LMSApiResponseStatus.Success, items, malformed: false };
  }

  private extractList(data: unknown, wrapKey?: string): unknown[] | null {
    const direct = asArray(data);
    if (direct) return direct;
    if (wrapKey !== undefined) {
      const wrapped = asObject(data);
      if (wrapped) {
        const list = asArray(wrapped[wrapKey]);
        if (list) return list;
      }
    }
    return null;
  }

  async GetPaginated(
    initialPath: string,
  ): Promise<{ status: LMSApiResponseStatus; data?: any }> {
    let data: any[] = [];
    let nextLink =
      initialPath.indexOf('?') != -1
        ? `${initialPath}&per_page=50`
        : `${initialPath}?per_page=50`;

    while (nextLink !== undefined) {
      const res = await this.Get(nextLink);
      if (res.status != LMSApiResponseStatus.Success)
        return { status: res.status, data: [] };

      data = [...data, ...res.data];
      nextLink = res.nextLink;
    }
    return { status: LMSApiResponseStatus.Success, data };
  }

  async getUserCourses(): Promise<{
    status: LMSApiResponseStatus;
    courses: LMSCourseAPIResponse[];
  }> {
    const token = await this.integration.accessToken.getToken();

    const { status, data } = await this.GetPaginated(
      `users/${token.userId}/courses`,
    );
    if (status != LMSApiResponseStatus.Success) return { status, courses: [] };

    return {
      status: LMSApiResponseStatus.Success,
      courses: data.map((course: any) => ({
        id: course.id,
        name: course.name,
        code: course.course_code,
        studentCount: 0,
      })),
    };
  }

  async getCourse(): Promise<{
    status: LMSApiResponseStatus;
    course: LMSCourseAPIResponse;
  }> {
    const { status, data } = await this.Get(
      `courses/${this.integration.apiCourseId}?include[]=total_students`,
    );
    if (status != LMSApiResponseStatus.Success)
      return { status, course: {} as any };

    return {
      status: LMSApiResponseStatus.Success,
      course: {
        id: data.id,
        name: data.name,
        code: data.course_code,
        studentCount: data.total_students,
      } satisfies LMSCourseAPIResponse,
    };
  }

  async getStudents(): Promise<{
    status: LMSApiResponseStatus;
    students: string[];
  }> {
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/enrollments?type[]=StudentEnrollment&state[]=active`,
    );

    if (status != LMSApiResponseStatus.Success) return { status, students: [] };

    return {
      status: LMSApiResponseStatus.Success,
      students: data
        .filter((student: any) => student.user != undefined)
        .map((student: any) => student.user.name),
    };
  }

  async getAnnouncements(): Promise<{
    status: LMSApiResponseStatus;
    announcements: LMSAnnouncement[];
  }> {
    const { status: instructorStatus, instructorIds } =
      await this.getInstructorIds();

    // Get announcements using only_announcements=true
    const { status: announcementStatus, data: announcementData } =
      await this.GetPaginated(
        `courses/${this.integration.apiCourseId}/discussion_topics?only_announcements=true`,
      );

    // Get all discussion topics for instructor posts
    const { status: discussionStatus, data: discussionData } =
      await this.GetPaginated(
        `courses/${this.integration.apiCourseId}/discussion_topics`,
      );

    if (
      announcementStatus != LMSApiResponseStatus.Success &&
      discussionStatus != LMSApiResponseStatus.Success
    ) {
      return { status: announcementStatus, announcements: [] };
    }

    // Filter instructor discussion posts (exclude announcements to avoid duplicates)
    const instructorPosts = discussionData.filter(
      (d: any) =>
        d.posted_at != undefined &&
        !d.is_announcement &&
        d.author &&
        instructorIds.has(d.author.id),
    );

    const data = [...announcementData, ...instructorPosts];

    const announcements: LMSAnnouncement[] = data
      .filter((d: any) => d.posted_at != undefined)
      .map((announcement: any) => {
        return {
          id: announcement.id,
          title: announcement.title,
          message: announcement.message,
          posted:
            announcement.posted_at != undefined &&
            announcement.posted_at.trim() != ''
              ? new Date(announcement.posted_at)
              : undefined,
          modified:
            announcement.last_reply_at != undefined &&
            announcement.last_reply_at.trim() != ''
              ? new Date(announcement.last_reply_at)
              : undefined,
        } as LMSAnnouncement;
      });
    announcements.sort((a0, a1) => {
      if (a0.posted == undefined) return 1;
      else if (a1.posted == undefined) return -1;
      else return a0.posted.getTime() - a1.posted.getTime();
    });

    return {
      status: LMSApiResponseStatus.Success,
      announcements,
    };
  }

  private async getInstructorIds(): Promise<{
    status: LMSApiResponseStatus;
    instructorIds: Set<number>;
  }> {
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/users?sort=username&enrollment_type[]=teacher&enrollment_type[]=ta`,
    );

    if (status != LMSApiResponseStatus.Success)
      return { status, instructorIds: new Set() };

    return {
      status: LMSApiResponseStatus.Success,
      instructorIds: new Set(data.map((user: any) => user.id)),
    };
  }

  async getAssignments(): Promise<{
    status: LMSApiResponseStatus;
    assignments: LMSAssignment[];
  }> {
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/assignments`,
    );

    if (status != LMSApiResponseStatus.Success)
      return { status, assignments: [] };

    const assignments: LMSAssignment[] = data
      .filter((assignment: any) => assignment.published == true)
      .map((assignment: any) => {
        return {
          id: assignment.id,
          name: assignment.name,
          description: assignment.description,
          due:
            assignment.due_at != undefined && assignment.due_at.trim() != ''
              ? new Date(assignment.due_at)
              : undefined,
          modified:
            assignment.updated_at != undefined &&
            assignment.updated_at.trim() != ''
              ? new Date(assignment.updated_at)
              : undefined,
        } as LMSAssignment;
      });

    return {
      status: LMSApiResponseStatus.Success,
      assignments,
    };
  }

  async getPages(): Promise<{
    status: LMSApiResponseStatus;
    pages: LMSPage[];
  }> {
    const pagesKey = `pages_complete_${this.integration.apiCourseId}`;

    if (this.cacheManager) {
      const cachedPages = await this.cacheManager.get(pagesKey);
      if (cachedPages) {
        return cachedPages as {
          status: LMSApiResponseStatus;
          pages: LMSPage[];
        };
      }
    }

    // If not cached, fetch as normal
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/pages`,
    );

    if (status != LMSApiResponseStatus.Success) return { status, pages: [] };

    const pages: LMSPage[] = [];

    // Individual page calls will now be cached by the Get() method
    for (const page of data.filter((datum: any) => datum.published == true)) {
      const pageResult = await this.Get(
        `courses/${this.integration.apiCourseId}/pages/${page.url}`,
      );

      if (pageResult.status === LMSApiResponseStatus.Success) {
        pages.push({
          id: pageResult.data.page_id,
          title: pageResult.data.title,
          body: pageResult.data.body,
          url: page.url,
          frontPage: page.front_page,
          modified: new Date(pageResult.data.updated_at),
        });
      }
    }

    const result = {
      status: LMSApiResponseStatus.Success,
      pages,
    };

    // Cache complete result for 10 minutes
    if (this.cacheManager) {
      await this.cacheManager.set(pagesKey, result, 600000);
    }

    return result;
  }

  async getFiles(): Promise<{
    status: LMSApiResponseStatus;
    files: LMSFile[];
  }> {
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/files`,
    );

    if (status != LMSApiResponseStatus.Success) return { status, files: [] };

    const files: LMSFile[] = data
      .filter((file: any) => !file.locked && !file.hidden)
      .map((file: any) => {
        return {
          id: file.id,
          name: file.display_name || file.filename,
          url: file.url,
          contentType: file['content-type'] || 'application/octet-stream',
          size: file.size || 0,
          modified: file.modified_at ? new Date(file.modified_at) : new Date(),
        } as LMSFile;
      });

    return {
      status: LMSApiResponseStatus.Success,
      files,
    };
  }

  async getQuizzes(): Promise<{
    status: LMSApiResponseStatus;
    quizzes: LMSQuiz[];
  }> {
    const { status, data } = await this.GetPaginated(
      `courses/${this.integration.apiCourseId}/quizzes`,
    );

    if (status != LMSApiResponseStatus.Success) return { status, quizzes: [] };

    const quizzes: LMSQuiz[] = [];

    for (const quiz of data.filter((q: any) => q.published)) {
      const { status: quizStatus, data: quizData } = await this.Get(
        `courses/${this.integration.apiCourseId}/quizzes/${quiz.id}`,
      );

      let questionsData = [];

      if (quizData?.question_count > 0) {
        const { status: questionsStatus, data: questionsResponse } =
          await this.Get(
            `courses/${this.integration.apiCourseId}/quizzes/${quiz.id}/questions`,
          );
        if (questionsStatus === LMSApiResponseStatus.Success) {
          questionsData = questionsResponse || [];
        }
      }

      // Placeholder questions if no questions fetched from the API
      if (questionsData.length === 0 && quizData?.question_count > 0) {
        console.log(
          `Quiz ${quiz.id}: No question details available (likely permissions), using question_count: ${quizData.question_count}`,
        );
        for (let i = 1; i <= quizData.question_count; i++) {
          questionsData.push({
            id: `placeholder_${quiz.id}_${i}`,
            question_text: `Question ${i} (content not accessible via API)`,
            question_type: 'multiple_choice_question',
          });
        }
      }

      if (quizStatus === LMSApiResponseStatus.Success) {
        // Helper function to safely parse dates
        const safeParseDate = (
          dateString: string | null | undefined,
        ): Date | undefined => {
          if (!dateString) return undefined;
          const parsed = new Date(dateString);
          return isNaN(parsed.getTime()) ? undefined : parsed;
        };

        quizzes.push({
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          due: safeParseDate(quiz.due_at),
          unlock: safeParseDate(quiz.unlock_at),
          lock: safeParseDate(quiz.lock_at),
          timeLimit: quiz.time_limit,
          allowedAttempts: quiz.allowed_attempts,
          questions: questionsData,
          modified: safeParseDate(quiz.updated_at) || new Date(),
        } as LMSQuiz);
      }
    }

    return { status: LMSApiResponseStatus.Success, quizzes };
  }

  async getClassicQuizCatalog(
    onlyQuizId?: number,
  ): Promise<LMSClassicQuizCatalogResult> {
    const courseId = this.integration.apiCourseId;

    // Keep these sequential so an expired OAuth token is refreshed once.
    // The assignment carries `post_manually`; `GET quizzes/:id` is never used.
    const quizList = await this.GetPaginatedUncached(
      `courses/${courseId}/quizzes`,
    );
    const assignmentList = await this.GetPaginatedUncached(
      `courses/${courseId}/assignments`,
    );

    if (quizList.status !== LMSApiResponseStatus.Success) {
      return { status: quizList.status, quizzes: [] };
    }
    if (assignmentList.status !== LMSApiResponseStatus.Success) {
      return { status: assignmentList.status, quizzes: [] };
    }
    if (quizList.malformed || assignmentList.malformed) {
      return { status: LMSApiResponseStatus.Error, quizzes: [] };
    }

    const assignmentsById = new Map<number, JsonObject>();
    for (const raw of assignmentList.items) {
      const assignment = asObject(raw);
      const assignmentId = assignment ? asId(assignment.id) : null;
      if (assignment && assignmentId !== null) {
        assignmentsById.set(assignmentId, assignment);
      }
    }

    const quizzes: LMSClassicQuiz[] = [];
    for (const raw of quizList.items) {
      const quiz = asObject(raw);
      if (!quiz || quiz.published !== true) continue;

      const quizId = asId(quiz.id);
      const assignmentId = asId(quiz.assignment_id);
      if (quizId === null || assignmentId === null) continue;
      if (onlyQuizId !== undefined && quizId !== onlyQuizId) continue;

      // A Classic quiz without an assignment is a practice quiz: it produces
      // no graded submission, so it is not eligible for batch grading.
      const assignment = assignmentsById.get(assignmentId);
      if (!assignment) continue;

      const questionList = await this.GetPaginatedUncached(
        `courses/${courseId}/quizzes/${quizId}/questions`,
      );
      if (questionList.status !== LMSApiResponseStatus.Success) {
        return { status: questionList.status, quizzes: [] };
      }
      if (questionList.malformed) {
        return { status: LMSApiResponseStatus.Error, quizzes: [] };
      }

      const essayQuestions: LMSClassicQuizQuestion[] = [];
      for (const [questionIndex, rawQuestion] of questionList.items.entries()) {
        const question = asObject(rawQuestion);
        if (!question || question.question_type !== 'essay_question') continue;
        const questionId = asId(question.id);
        if (questionId === null) continue;
        const canvasPosition = asNumber(question.position);
        const position =
          canvasPosition !== null && canvasPosition > 0
            ? canvasPosition
            : questionIndex + 1;
        essayQuestions.push({
          id: questionId,
          position,
          text: htmlToEssayText(question.question_text),
          points: asNumber(question.points_possible) ?? 0,
          mapping: await this.resolveQuestionMapping(
            question.question_text,
            position,
          ),
        });
      }

      quizzes.push({
        quizId,
        title: asString(quiz.title) ?? '',
        assignmentId,
        postManually:
          asBoolean(assignment.post_manually) ??
          asBoolean(quiz.post_manually) ??
          false,
        speedGraderUrl: this.speedGraderUrl(assignmentId),
        essayQuestions,
      });
    }

    return { status: LMSApiResponseStatus.Success, quizzes };
  }

  private async resolveQuestionMapping(
    html: unknown,
    position: number,
  ): Promise<LMSClassicQuestionMapping> {
    const lookupUuids = resourceLinkLookupUuids(html);
    if (lookupUuids.length === 0) {
      return {
        status: 'error',
        message: `Question ${position} does not contain a HelpMe embed.`,
      };
    }

    const resolved = await Promise.all(
      lookupUuids.map(async (lookupUuid) => {
        const response = await this.requestGet(
          `courses/${this.integration.apiCourseId}/lti_resource_links/lookup_uuid:${lookupUuid}`,
        );
        if (response.status !== LMSApiResponseStatus.Success) {
          return { lookupUuid, failed: true, status: response.status } as const;
        }
        const resource = asObject(response.data);
        const custom = resource ? asObject(resource.custom) : null;
        return {
          lookupUuid,
          failed: false,
          embeddableQuestionId: custom ? asId(custom.helpme_question_id) : null,
        } as const;
      }),
    );
    const failed = resolved.find((resource) => resource.failed);
    if (failed?.failed) {
      return {
        status: 'error',
        message: `Question ${position}: Canvas could not resolve an embedded resource link. ${failed.status}`,
      };
    }

    const helpMeLinks = resolved.filter(
      (resource) => !resource.failed && resource.embeddableQuestionId !== null,
    );
    if (helpMeLinks.length !== 1) {
      return {
        status: 'error',
        message:
          helpMeLinks.length === 0
            ? `Question ${position} does not contain a recognizable HelpMe embed.`
            : `Question ${position} contains more than one HelpMe embed.`,
      };
    }
    return {
      status: 'detected',
      lookupUuid: helpMeLinks[0].lookupUuid,
      embeddableQuestionId: helpMeLinks[0].embeddableQuestionId,
    };
  }

  async getClassicAttemptSnapshots(
    params: LMSClassicQuizRef,
  ): Promise<LMSClassicAttemptSnapshotResult> {
    return this.collectClassicAttempts(params);
  }

  async getClassicAttemptSnapshot(
    params: LMSClassicAttemptRef,
  ): Promise<LMSClassicAttemptSnapshotResult> {
    return this.collectClassicAttempts(params, {
      userId: params.userId,
      attempt: params.attempt,
    });
  }

  async putClassicAttemptGrades(
    params: LMSClassicAttemptGradesUpdate,
  ): Promise<LMSWriteResult> {
    if (params.questions.length === 0) {
      return {
        outcome: 'rejected',
        message: 'At least one question score is required.',
      };
    }

    // Every safe question is sent in one request. Only per-question scores and
    // comments are included; aggregate fields (fudge_points, submission score)
    // are intentionally omitted so a batch write can never move a student's
    // total.
    const questions = Object.fromEntries(
      params.questions.map(({ questionId, score, comment }) => [
        questionId,
        { score, comment },
      ]),
    );

    return this.sendCanvasWrite(
      `courses/${this.integration.apiCourseId}/quizzes/${params.quizId}/submissions/${params.quizSubmissionId}`,
      {
        quiz_submissions: [
          {
            // Canvas rejects the request when the attempt is missing.
            attempt: params.attempt,
            questions,
          },
        ],
      },
    );
  }

  private speedGraderUrl(assignmentId: number): string {
    return `${this.canvasBaseUrl()}/courses/${this.integration.apiCourseId}/gradebook/speed_grader?assignment_id=${assignmentId}`;
  }

  private async collectClassicAttempts(
    ref: LMSClassicQuizRef,
    filter?: { userId: number; attempt?: number },
  ): Promise<LMSClassicAttemptSnapshotResult> {
    const courseId = this.integration.apiCourseId;

    // Keep these sequential so an expired OAuth token is refreshed once.
    const quizSubmissions = await this.GetPaginatedUncached(
      `courses/${courseId}/quizzes/${ref.quizId}/submissions`,
      'quiz_submissions',
    );
    const assignmentSubmissions = await this.GetPaginatedUncached(
      `courses/${courseId}/assignments/${ref.assignmentId}/submissions` +
        `?include[]=submission_history` +
        (filter ? `&student_ids[]=${filter.userId}` : ''),
    );

    if (quizSubmissions.status !== LMSApiResponseStatus.Success) {
      return { status: quizSubmissions.status };
    }
    if (assignmentSubmissions.status !== LMSApiResponseStatus.Success) {
      return { status: assignmentSubmissions.status };
    }
    if (quizSubmissions.malformed || assignmentSubmissions.malformed) {
      return { status: LMSApiResponseStatus.Error };
    }

    const submissionsByUser = new Map<number, JsonObject>();
    for (const raw of assignmentSubmissions.items) {
      const submission = asObject(raw);
      const userId = submission ? asId(submission.user_id) : null;
      if (submission && userId !== null) {
        submissionsByUser.set(userId, submission);
      }
    }

    const trustedAttempts = new Map<
      string,
      { quizSubmissionId: number; userId: number; attempt: number }
    >();
    const currentByUser = new Map<
      number,
      { quizSubmissionId: number; attempt: number; completed: boolean }
    >();
    for (const raw of quizSubmissions.items) {
      const quizSubmission = asObject(raw);
      if (!quizSubmission) continue;

      const quizSubmissionId = asId(quizSubmission.id);
      const userId = asId(quizSubmission.user_id);
      const attempt = asNumber(quizSubmission.attempt);
      if (quizSubmissionId === null || userId === null || attempt === null) {
        continue;
      }
      if (filter && userId !== filter.userId) continue;
      const workflowState = asString(quizSubmission.workflow_state);
      const completed =
        workflowState === 'complete' || workflowState === 'pending_review';
      const current = currentByUser.get(userId);
      if (
        !current ||
        attempt > current.attempt ||
        (attempt === current.attempt && completed && !current.completed)
      ) {
        currentByUser.set(userId, { quizSubmissionId, attempt, completed });
      }
      // Only finished attempts are eligible for batch grading: a student has
      // submitted and Canvas has either marked it complete or is holding it for
      // manual review. Preview, in-progress, untaken, and settings rows are
      // excluded.
      if (!completed) {
        continue;
      }
      trustedAttempts.set(`${userId}:${attempt}`, {
        quizSubmissionId,
        userId,
        attempt,
      });
    }

    // Canvas returns the current quiz-submission row. The assignment submission
    // history is therefore the source of completed attempt numbers and answers,
    // while the documented quiz-submission list remains the trust anchor for
    // user/submission identity. A later attempt proves earlier history attempts
    // were finished; an explicitly non-final history state is still excluded.
    for (const [userId, current] of currentByUser) {
      const submission = submissionsByUser.get(userId);
      for (const rawHistory of asArray(submission?.submission_history) ?? []) {
        const history = asObject(rawHistory);
        const attempt = history ? asNumber(history.attempt) : null;
        if (!history || attempt === null || attempt > current.attempt) continue;
        const workflowState = asString(history.workflow_state);
        if (
          workflowState !== null &&
          workflowState !== 'complete' &&
          workflowState !== 'pending_review'
        ) {
          continue;
        }
        if (
          attempt === current.attempt &&
          !current.completed &&
          workflowState === null
        ) {
          continue;
        }
        const key = `${userId}:${attempt}`;
        if (!trustedAttempts.has(key)) {
          trustedAttempts.set(key, {
            quizSubmissionId: current.quizSubmissionId,
            userId,
            attempt,
          });
        }
      }
    }

    const attempts = [...trustedAttempts.values()]
      .filter(
        (candidate) =>
          filter?.attempt === undefined || candidate.attempt === filter.attempt,
      )
      .sort((left, right) =>
        left.userId === right.userId
          ? left.attempt - right.attempt
          : left.userId - right.userId,
      )
      .map((candidate) =>
        this.buildClassicAttempt({
          ...candidate,
          submission: submissionsByUser.get(candidate.userId),
        }),
      );

    return {
      status: LMSApiResponseStatus.Success,
      snapshot: { quizId: ref.quizId, attempts },
    };
  }

  private buildClassicAttempt(input: {
    quizSubmissionId: number;
    userId: number;
    attempt: number;
    submission: JsonObject | undefined;
  }): LMSClassicAttempt {
    const { quizSubmissionId, userId, attempt, submission } = input;
    const record = this.findAttemptRecord(submission, attempt);
    const data = record ? asArray(record.submission_data) : null;
    const answers = data === null ? null : this.readClassicAnswers(data);

    return {
      quizSubmissionId,
      userId,
      attempt,
      postedAt:
        (record ? asString(record.posted_at) : null) ??
        (submission ? asString(submission.posted_at) : null),
      excused:
        (record ? asBoolean(record.excused) : null) ??
        (submission ? asBoolean(submission.excused) : null) ??
        false,
      // A missing or malformed history is reported as unreadable instead of an
      // attempt with no answers.
      readable: answers !== null,
      answers: answers ?? [],
    };
  }

  /**
   * Locate the submission record holding the answers for `attempt`.
   *
   * Completed answers are read only from `submission_history[].submission_data`;
   * the quiz question endpoint is never used. Returns null when Canvas did not
   * provide usable history for the attempt.
   */
  private findAttemptRecord(
    submission: JsonObject | undefined,
    attempt: number,
  ): JsonObject | null {
    if (!submission) return null;

    const rawHistory = submission.submission_history;
    if (
      rawHistory !== undefined &&
      rawHistory !== null &&
      asArray(rawHistory) === null
    ) {
      // Canvas answered with a history field that is not a list.
      return null;
    }

    const candidates: JsonObject[] = [];
    for (const rawEntry of asArray(rawHistory) ?? []) {
      const entry = asObject(rawEntry);
      if (entry && asNumber(entry.attempt) === attempt) candidates.push(entry);
    }
    // When history is omitted the submission itself may be the requested
    // attempt.
    if (asNumber(submission.attempt) === attempt) candidates.push(submission);

    return (
      candidates.find(
        (candidate) => asArray(candidate.submission_data) !== null,
      ) ?? null
    );
  }

  private readClassicAnswers(data: unknown[]): LMSClassicAttemptAnswer[] {
    const answers: LMSClassicAttemptAnswer[] = [];
    for (const rawEntry of data) {
      const entry = asObject(rawEntry);
      if (!entry) continue;
      const questionId = asId(entry.question_id);
      const text = asString(entry.text);
      // Mixed quizzes include non-essay answer shapes such as file uploads.
      // Ignore entries that cannot be represented as essay answers; a mapped
      // essay with malformed fields is then handled as a missing answer.
      if (questionId === null || text === null) continue;
      const rawComment = entry.more_comments ?? entry.comment;
      const comment = rawComment == null ? null : asString(rawComment);
      if (rawComment != null && comment === null) continue;
      // Canvas serializes an unanswered grading decision for Classic essay
      // questions as `points: 0` together with `correct: "undefined"`.
      // Treating that placeholder zero as an instructor grade would skip every
      // newly submitted essay before HelpMe can grade it.
      const rawPoints = entry.points;
      const ungradedPlaceholder = asString(entry.correct) === 'undefined';
      const points =
        ungradedPlaceholder || rawPoints == null ? null : asNumber(rawPoints);
      if (!ungradedPlaceholder && rawPoints != null && points === null) {
        continue;
      }
      answers.push({
        questionId,
        text: htmlToEssayText(text),
        points,
        comment,
      });
    }
    return answers;
  }

  /**
   * Send a Canvas PUT and classify its outcome.
   *
   * The request is never retried. A non-2xx answer is a definite rejection,
   * while a timeout, socket error, or abort is reported as an unknown outcome.
   */
  private async sendCanvasWrite(
    path: string,
    body: unknown,
  ): Promise<LMSWriteResult> {
    let authorization: string;
    try {
      authorization = await this.getAuthorization();
    } catch (error) {
      return {
        outcome: 'rejected',
        message:
          error instanceof Error ? error.message : 'Authorization failed.',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CANVAS_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${this.canvasBaseUrl()}/api/v1/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) {
        return { outcome: 'success', httpStatus: response.status };
      }

      return {
        outcome: 'rejected',
        httpStatus: response.status,
        message: await this.readWriteErrorMessage(response),
      };
    } catch (error) {
      return {
        outcome: 'unknown',
        message:
          error instanceof Error ? error.message : 'Unknown transport error.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readWriteErrorMessage(
    response: Response,
  ): Promise<string | undefined> {
    if (response.status === 401) return LMSApiResponseStatus.Unauthorized;
    if (response.status === 403) return LMSApiResponseStatus.Forbidden;
    try {
      const text = await response.text();
      if (text.trim() === '') return undefined;

      try {
        const parsed: unknown = JSON.parse(text);
        const parsedObject = asObject(parsed);
        if (parsedObject) {
          const message = asString(parsedObject.message);
          if (message) return message;
          const errors = asArray(parsedObject.errors);
          if (errors) {
            const first = asObject(errors[0]);
            const errorMessage = first ? asString(first.message) : null;
            if (errorMessage) return errorMessage;
          }
        }
      } catch {
        // The rejection body was not JSON; fall through to the raw text.
      }

      return text.slice(0, 500);
    } catch {
      return undefined;
    }
  }

  getDocumentLink(documentId: number, documentType: LMSUpload): string {
    switch (documentType) {
      case LMSUpload.Announcements:
        return `https://${this.integration.orgIntegration.rootUrl}/courses/${this.integration.apiCourseId}/discussion_topics/${documentId}/`;
      case LMSUpload.Assignments:
        return `https://${this.integration.orgIntegration.rootUrl}/courses/${this.integration.apiCourseId}/assignments/${documentId}/`;
      case LMSUpload.Pages:
        return `https://${this.integration.orgIntegration.rootUrl}/courses/${this.integration.apiCourseId}/pages/${documentId}/`;
      case LMSUpload.Files:
        return `https://${this.integration.orgIntegration.rootUrl}/courses/${this.integration.apiCourseId}/files/${documentId}/`;
      case LMSUpload.Quizzes:
        return `https://${this.integration.orgIntegration.rootUrl}/courses/${this.integration.apiCourseId}/quizzes/${documentId}/`;
      default:
        return '';
    }
  }
}
