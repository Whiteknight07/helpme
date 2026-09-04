import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbeddableQuestion1788000000000 implements MigrationInterface {
  name = 'EmbeddableQuestion1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "embeddable_question_model" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "courseId" integer NOT NULL, "name" text, "questionText" text NOT NULL, "criteriaText" text NOT NULL, "instructions" text, "minSentences" integer NOT NULL DEFAULT '3', "maxSentences" integer NOT NULL DEFAULT '5', CONSTRAINT "PK_7221480303ac557d4312f9f7e55" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "embeddable_question_feedback_model" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "courseId" integer NOT NULL, "questionId" integer NOT NULL, "userId" integer, "ltiIssuer" text, "ltiSubject" text, "submission" text NOT NULL, "aiFeedback" text NOT NULL, "aiGrade" double precision NOT NULL, "reasons" text array NOT NULL DEFAULT '{}', "needsHumanReview" boolean NOT NULL DEFAULT false, "aiModel" text, CONSTRAINT "CHK_embeddable_feedback_attribution" CHECK ("userId" IS NOT NULL OR ("ltiIssuer" IS NOT NULL AND "ltiSubject" IS NOT NULL)), CONSTRAINT "PK_44f928f5436a18d1c85c1152ad9" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "embeddable_grading_profile_model" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "courseId" integer NOT NULL, "policyKind" text NOT NULL DEFAULT 'generic', "systemPrompt" text NOT NULL, "allowedScores" double precision array NOT NULL, "reasonCodes" text array NOT NULL, CONSTRAINT "UQ_8c119142aa8eac1a10d21b1616d" UNIQUE ("courseId"), CONSTRAINT "PK_f1d153b28ad0a413b0a81805aaf" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_model" ADD CONSTRAINT "FK_79ca48befc343d6f6957ea87376" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_21ce283653acf7fe839e4b5a298" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_d052d8fe0b07aca9c6f7625ef57" FOREIGN KEY ("questionId") REFERENCES "embeddable_question_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD CONSTRAINT "FK_206d465aab2d93ecc9aac1e76da" FOREIGN KEY ("userId") REFERENCES "user_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "embeddable_grading_profile_model" ADD CONSTRAINT "FK_8c119142aa8eac1a10d21b1616d" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_grading_profile_model" DROP CONSTRAINT "FK_8c119142aa8eac1a10d21b1616d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_206d465aab2d93ecc9aac1e76da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_d052d8fe0b07aca9c6f7625ef57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP CONSTRAINT "FK_21ce283653acf7fe839e4b5a298"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_model" DROP CONSTRAINT "FK_79ca48befc343d6f6957ea87376"`,
    );
    await queryRunner.query(`DROP TABLE "embeddable_grading_profile_model"`);
    await queryRunner.query(`DROP TABLE "embeddable_question_feedback_model"`);
    await queryRunner.query(`DROP TABLE "embeddable_question_model"`);
  }
}
