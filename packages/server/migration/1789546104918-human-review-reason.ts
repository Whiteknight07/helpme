import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase-one shared prerequisite for the human review reason. The column is
// nullable and has no default on purpose: rows that were flagged for review
// before this column existed keep a null reason rather than an invented one.
export class HumanReviewReason1789546104918 implements MigrationInterface {
  name = 'HumanReviewReason1789546104918';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD COLUMN IF NOT EXISTS "humanReviewReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP COLUMN IF EXISTS "humanReviewReason"`,
    );
  }
}
