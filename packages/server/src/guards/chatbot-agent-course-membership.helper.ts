import { Role, SuperCoursePurpose } from '@koh/common';
import { CourseModel } from '../course/course.entity';
import { UserModel } from '../profile/user.entity';
import { SuperCourseModel } from '../course/super-course.entity';

export async function inheritedChatbotAgentCourseRole(
  user: UserModel | null,
  courseId: number | string,
): Promise<Role | null> {
  const cid = Number(courseId);
  if (!user) {
    return null;
  }

  if (user.courses?.find((c) => Number(c.courseId) === cid)) {
    return null;
  }

  const superCourse = await SuperCourseModel.findGroupForCourse(
    cid,
    SuperCoursePurpose.CHATBOT_AGENT_GROUP,
  );
  const requestedCourse = superCourse?.courses.find(
    (groupCourse: CourseModel) => Number(groupCourse.id) === cid,
  );
  if (!requestedCourse?.chatbotAgentName) {
    return null;
  }

  const parentMembership = user.courses.find((userCourse) =>
    superCourse.courses.some(
      (groupCourse: CourseModel) =>
        Number(groupCourse.id) === Number(userCourse.courseId) &&
        !groupCourse.chatbotAgentName,
    ),
  );
  if (!parentMembership) {
    return null;
  }

  return parentMembership.role;
}
