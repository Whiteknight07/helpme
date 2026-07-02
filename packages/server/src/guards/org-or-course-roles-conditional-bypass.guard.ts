import { Injectable } from '@nestjs/common';
import { UserModel } from '../profile/user.entity';
import { OrgOrCourseRolesGuard } from './org-or-course-roles.guard';
import { inheritedChatbotAgentCourseRole } from './chatbot-agent-course-membership.helper';

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
    const role = await inheritedChatbotAgentCourseRole(user, courseId);
    return role !== null && roles.includes(role.toString());
  }
}
