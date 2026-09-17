import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveHumanReviewFlag1789546104919 implements MigrationInterface {
  name = 'RemoveHumanReviewFlag1789546104919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP COLUMN IF EXISTS "needsHumanReview"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD COLUMN IF NOT EXISTS "needsHumanReview" boolean NOT NULL DEFAULT false`,
    );
  }
}
