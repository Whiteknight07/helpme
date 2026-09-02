import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CourseModel } from '../../../course/course.entity';
import { Exclude } from 'class-transformer';
import { EmbeddableQuestionFeedbackModel } from './embeddable-question-feedback.entity';

@Entity('embeddable_question_model')
export class EmbeddableQuestionModel extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  availableFrom?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  availableUntil?: Date;

  @ManyToOne(() => CourseModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  @Exclude()
  course: CourseModel;

  @Column({ type: 'integer', nullable: false })
  courseId: number;

  @Column({ type: 'text', nullable: false })
  name: string;

  @Column({ type: 'text', nullable: false })
  questionText: string;

  @Column({ type: 'text', nullable: false })
  criteriaText: string;

  @Column({ type: 'text', nullable: true })
  instructions?: string;

  @Column({ type: 'integer', nullable: false, default: 3 })
  minSentences: number;

  @Column({ type: 'integer', nullable: false, default: 5 })
  maxSentences: number;

  @OneToMany(
    () => EmbeddableQuestionFeedbackModel,
    (feedback) => feedback.embeddableQuestion,
  )
  @Exclude()
  submissions: EmbeddableQuestionFeedbackModel[];

  @Column({ type: 'boolean', default: false })
  isWeak: boolean;
}
