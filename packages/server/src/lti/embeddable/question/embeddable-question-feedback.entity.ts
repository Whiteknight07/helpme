import {
  BaseEntity,
  Check,
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

@Entity('embeddable_question_feedback_model')
@Check(
  'CHK_embeddable_feedback_attribution',
  '"userId" IS NOT NULL OR ("ltiIssuer" IS NOT NULL AND "ltiSubject" IS NOT NULL)',
)
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

  @ManyToOne(() => EmbeddableQuestionModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'questionId' })
  embeddableQuestion: EmbeddableQuestionModel;

  @Column({ type: 'integer', nullable: true })
  userId: number | null;

  @ManyToOne(() => UserModel, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: UserModel | null;

  @Column({ type: 'text', nullable: true })
  ltiIssuer: string | null;

  @Column({ type: 'text', nullable: true })
  ltiSubject: string | null;

  @Column({ type: 'text', nullable: false })
  submission: string;

  @Column({ type: 'text', nullable: false })
  aiFeedback: string;

  @Column({ type: 'double precision', nullable: false })
  aiGrade: number;

  @Column({ type: 'text', array: true, nullable: false, default: [] })
  reasons: string[];

  @Column({ type: 'boolean', default: false })
  needsHumanReview: boolean;

  @Column({ type: 'text', nullable: true })
  aiModel: string | null;
}
