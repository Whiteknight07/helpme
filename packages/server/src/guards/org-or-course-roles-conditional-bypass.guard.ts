import { Injectable } from '@nestjs/common';
import { UserModel } from '../profile/user.entity';
import { OrgOrCourseRolesGuard } from './org-or-course-roles.guard';
import { addInheritedChatbotAgentCourseMembership } from './chatbot-agent-course-membership.helper';

@Injectable()
export class OrgOrCourseRolesConditionalBypassGuard extends OrgOrCourseRolesGuard {
  async matchCourseRoles(
    roles: string[],
    userId: number,
    courseId: number,
  ): Promise<boolean> {
    if (await super.matchCourseRoles(roles, userId, courseId)) {
      return true;
    }

    const user = await UserModel.findOne({
      where: { id: userId },
      relations: { courses: true },
    });
    await addInheritedChatbotAgentCourseMembership(user, courseId);
    const inheritedMembership = user?.courses.find(
      (course) => Number(course.courseId) === Number(courseId),
    );
    if (!inheritedMembership) {
      return false;
    }

    return roles.includes(inheritedMembership.role.toString());
  }
}
