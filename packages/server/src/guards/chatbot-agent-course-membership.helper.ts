import { SuperCoursePurpose } from '@koh/common';
import { CourseModel } from '../course/course.entity';
import { UserModel } from '../profile/user.entity';
import { SuperCourseModel } from '../course/super-course.entity';
import { UserCourseModel } from '../profile/user-course.entity';

export async function addInheritedChatbotAgentCourseMembership(
  user: UserModel | null,
  courseId: number | string,
): Promise<void> {
  if (!user) {
    return;
  }

  if (user.courses?.find((c) => Number(c.courseId) === Number(courseId))) {
    return;
  }

  const superCourse = await SuperCourseModel.findGroupForCourse(
    Number(courseId),
    SuperCoursePurpose.CHATBOT_AGENT_GROUP,
  );
  const requestedCourse = superCourse?.courses.find(
    (groupCourse: CourseModel) => Number(groupCourse.id) === Number(courseId),
  );
  if (!requestedCourse?.chatbotAgentName) {
    return;
  }

  const parentMembership = user.courses.find((userCourse) =>
    superCourse.courses.some(
      (groupCourse: CourseModel) =>
        Number(groupCourse.id) === Number(userCourse.courseId) &&
        !groupCourse.chatbotAgentName,
    ),
  );
  if (parentMembership) {
    const inheritedMembership = new UserCourseModel();
    inheritedMembership.courseId = Number(courseId);
    inheritedMembership.role = parentMembership.role;
    user.courses.push(inheritedMembership);
  }
}
