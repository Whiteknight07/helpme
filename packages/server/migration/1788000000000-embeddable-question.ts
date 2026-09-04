import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbeddableQuestion1788000000000 implements MigrationInterface {
  name = 'EmbeddableQuestion1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "embeddable_question_model" (
        "id" SERIAL NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "courseId" integer NOT NULL,
        "name" text,
        "questionText" text NOT NULL,
        "criteriaText" text NOT NULL,
        "instructions" text,
        "minSentences" integer NOT NULL DEFAULT 3,
        "maxSentences" integer NOT NULL DEFAULT 5,
        CONSTRAINT "PK_embeddable_question_model" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "embeddable_question_feedback_model" (
        "id" SERIAL NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "courseId" integer NOT NULL,
        "questionId" integer NOT NULL,
        "userId" integer,
        "ltiIssuer" text,
        "ltiSubject" text,
        "submission" text NOT NULL,
        "aiFeedback" text NOT NULL,
        "aiGrade" double precision NOT NULL,
        "reasons" text array NOT NULL,
        "needsHumanReview" boolean NOT NULL DEFAULT false,
        "aiModel" text,
        CONSTRAINT "PK_embeddable_question_feedback_model" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "embeddable_grading_profile_model" (
        "id" SERIAL NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "courseId" integer NOT NULL,
        "policyKind" text NOT NULL DEFAULT 'generic',
        "systemPrompt" text NOT NULL,
        "allowedScores" double precision array NOT NULL,
        "reasonCodes" text array NOT NULL,
        CONSTRAINT "PK_embeddable_grading_profile_model" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_embeddable_grading_profile_course" UNIQUE ("courseId")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_model" ADD CONSTRAINT "FK_embeddable_question_course" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_embeddable_question_feedback_course" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_embeddable_question_feedback_question" FOREIGN KEY ("questionId") REFERENCES "embeddable_question_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_embeddable_question_feedback_user" FOREIGN KEY ("userId") REFERENCES "user_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_grading_profile_model" ADD CONSTRAINT "FK_embeddable_grading_profile_course" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "CHK_embeddable_feedback_attribution" CHECK ("userId" IS NOT NULL OR ("ltiIssuer" IS NOT NULL AND "ltiSubject" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "CHK_embeddable_feedback_attribution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_grading_profile_model" DROP CONSTRAINT "FK_embeddable_grading_profile_course"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_embeddable_question_feedback_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_embeddable_question_feedback_question"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_embeddable_question_feedback_course"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_model" DROP CONSTRAINT "FK_embeddable_question_course"`,
    );
    await queryRunner.query(`DROP TABLE "embeddable_grading_profile_model"`);
    await queryRunner.query(`DROP TABLE "embeddable_question_feedback_model"`);
    await queryRunner.query(`DROP TABLE "embeddable_question_model"`);
  }
}
