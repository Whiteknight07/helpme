import { Request } from 'express';
import { z } from 'zod';

export const EMBEDDABLE_RESOURCE_KIND = 'embeddable-resource' as const;

const embeddableResourcePayload = z.discriminatedUnion('role', [
  z.object({
    kind: z.literal(EMBEDDABLE_RESOURCE_KIND),
    role: z.literal('learner'),
    iss: z.string().min(1),
    sub: z.string().min(1),
    courseId: z.number().int().positive(),
    questionId: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal(EMBEDDABLE_RESOURCE_KIND),
    role: z.literal('staff'),
    iss: z.string().min(1),
    sub: z.string().min(1),
    courseId: z.number().int().positive(),
    questionId: z.number().int().positive(),
    userId: z.number().int().positive(),
  }),
]);

export type EmbeddableResourcePayload = z.infer<
  typeof embeddableResourcePayload
>;

export interface EmbeddableResourceRequest extends Request {
  resourceAuth: EmbeddableResourcePayload;
}

export function parseResourcePayload(
  value: unknown,
): EmbeddableResourcePayload | undefined {
  const parsed = embeddableResourcePayload.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function resourceCookieName(
  courseId: number,
  questionId: number,
): string {
  return `lti_resource_${courseId}_${questionId}`;
}

export function resourceCookiePath(
  courseId: number,
  questionId: number,
): string {
  return `/api/v1/lti/embeddable-resource/${courseId}/${questionId}`;
}
