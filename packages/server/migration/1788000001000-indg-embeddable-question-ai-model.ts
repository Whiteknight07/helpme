import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndgEmbeddableQuestionAiModel1788000001000 implements MigrationInterface {
  name = 'IndgEmbeddableQuestionAiModel1788000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" ADD "aiModel" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embeddable_question_feedback_model" DROP COLUMN "aiModel"`,
    );
  }
}
