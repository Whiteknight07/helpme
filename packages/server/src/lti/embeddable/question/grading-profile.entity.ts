import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CourseModel } from '../../../course/course.entity';
import { GradingPolicyKind } from '@koh/common';
import { Exclude } from 'class-transformer';

@Entity('embeddable_grading_profile_model')
@Unique(['courseId'])
export class EmbeddableGradingProfileModel extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updatedAt: Date;

  @ManyToOne(() => CourseModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'courseId' })
  @Exclude()
  course: CourseModel;

  @Column({ type: 'integer', nullable: false })
  courseId: number;

  @Column({ type: 'text', nullable: false, default: 'generic' })
  policyKind: GradingPolicyKind;

  @Column({ type: 'text', nullable: false })
  systemPrompt: string;

  @Column({ type: 'double precision', array: true, nullable: false })
  allowedScores: number[];

  @Column({ type: 'text', array: true, nullable: false })
  reasonCodes: string[];
}
