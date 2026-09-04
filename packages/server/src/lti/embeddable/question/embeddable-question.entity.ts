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
import { Exclude } from 'class-transformer';

@Entity('embeddable_question_model')
export class EmbeddableQuestionModel extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  availableFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  availableUntil: Date | null;

  @ManyToOne(() => CourseModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  @Exclude()
  course: CourseModel;

  @Column({ type: 'integer', nullable: false })
  courseId: number;

  @Column({ type: 'text', nullable: true })
  name: string | null;

  @Column({ type: 'text', nullable: false })
  questionText: string;

  @Column({ type: 'text', nullable: false })
  criteriaText: string;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ type: 'integer', nullable: false, default: 3 })
  minSentences: number;

  @Column({ type: 'integer', nullable: false, default: 5 })
  maxSentences: number;
}
