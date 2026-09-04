import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbeddableGradingProfile1788000002000 implements MigrationInterface {
  name = 'EmbeddableGradingProfile1788000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
      `ALTER TABLE "embeddable_grading_profile_model" ADD CONSTRAINT "FK_embeddable_grading_profile_course" FOREIGN KEY ("courseId") REFERENCES "course_model"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Courses with existing questions keep the present INDG behavior.
    await queryRunner.query(
      `INSERT INTO "embeddable_grading_profile_model" ("courseId", "policyKind", "systemPrompt", "allowedScores", "reasonCodes")
       SELECT DISTINCT "courseId", 'indg-reflection', 'You are grading one short reflective answer from an Indigenous Studies self-assessment.

You see exactly one question and one student answer. You have no memory of other students, other questions, or this student''s earlier submissions.

Mechanical facts in the user message (\`sentence_count\`, \`required_minimum\`, \`required_maximum\`, \`below_minimum\`) were computed by code. Trust them; do not recount sentences yourself.'::text, '{0,0.5,1,1.5,2}'::double precision[], '{blank,too_short,indigenous_capitalization,terminology_review,unreadable,off_topic,sensitive_content,meets_requirements,proofreading_note}'::text[]
       FROM "embeddable_question_model"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_grading_profile_model" DROP CONSTRAINT "FK_embeddable_grading_profile_course"`,
    );
    await queryRunner.query(`DROP TABLE "embeddable_grading_profile_model"`);
  }
}
