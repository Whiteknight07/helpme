import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbeddableResourceAuth1788000003000 implements MigrationInterface {
  name = 'EmbeddableResourceAuth1788000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD "ltiIssuer" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD "ltiSubject" text`,
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
      `ALTER TABLE "embeddable_question_feedback_model" DROP COLUMN "ltiSubject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP COLUMN "ltiIssuer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ALTER COLUMN "userId" SET NOT NULL`,
    );
  }
}
