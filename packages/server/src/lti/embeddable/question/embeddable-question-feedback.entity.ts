import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CourseModel } from '../../../course/course.entity';
import { UserModel } from '../../../profile/user.entity';
import { EmbeddableQuestionModel } from './embeddable-question.entity';
import { IndigenousReason, IndigenousScore } from '@koh/common';

@Entity('embeddable_question_feedback_model')
export class EmbeddableQuestionFeedbackModel extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  createdAt: Date;

  @Column({ type: 'integer', nullable: false })
  courseId: number;

  @ManyToOne(() => CourseModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  course: CourseModel;

  @Column({ type: 'integer', nullable: false })
  questionId: number;

  @ManyToOne(
    () => EmbeddableQuestionModel,
    (question) => question.submissions,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'questionId' })
  embeddableQuestion: EmbeddableQuestionModel;

  @Column({ type: 'integer', nullable: false })
  userId: number;

  @ManyToOne(() => UserModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserModel;

  @Column({ type: 'text', nullable: false })
  submission: string;

  @Column({ type: 'text', nullable: false })
  aiFeedback: string;

  @Column({ type: 'double precision', nullable: false })
  aiGrade: IndigenousScore;

  @Column({ type: 'simple-array', nullable: false })
  reasons: IndigenousReason[];

  @Column({ type: 'boolean', default: false })
  needsHumanReview: boolean;

  @Column({ type: 'text', nullable: true })
  aiModel: string | null;
}
