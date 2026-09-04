# LTI embedded question authentication

This note records the authentication and deadline questions found while adding
Canvas Deep Linking for embeddable questions. Scoped resource authentication is
implemented; deadline availability remains unresolved.

## Launches and later requests are different

Canvas starts an LTI launch when it loads a linked HelpMe question. Canvas sends
a signed ID token to the HelpMe launch endpoint. The LTI middleware verifies the
token before HelpMe trusts the Canvas user, role, course, and resource link.

HelpMe then redirects the iframe to the question page. Requests from that page
come from browser JavaScript. Canvas does not sign the later question and
feedback API requests. The verified question launch maps the Canvas course and
question, then issues the learner a 24-hour HelpMe-signed course/question-scoped
JWT in a dedicated cookie. Later GET and feedback routes use their own guard.
Feedback stores Canvas iss+sub with no HelpMe User, organization membership,
course enrollment, identity link, or full-app login. Staff previews require an
existing linked HelpMe staff enrollment. Expiry tells the learner to reopen the
Canvas quiz.

## Current instructor setup

Deep Linking does not yet include a HelpMe sign-in screen. Before inserting an
embeddable question, the instructor must link the Canvas identity to an existing
HelpMe staff account:

1. Confirm that the Canvas course is connected to the intended HelpMe course.
2. Confirm that the HelpMe account is enrolled in that course as a Professor or
   TA.
3. Open **HelpMe** from the Canvas course navigation.
4. Sign in to the existing HelpMe account. This links the exact Canvas issuer and
   user identifier to that account.
5. Return to the Canvas quiz editor and reopen the HelpMe editor button.

HelpMe must not match accounts by email, create an account, or grant a staff
enrollment during this flow. If the question picker still reports that no
HelpMe account is linked, verify the course connection and the Professor or TA
enrollment.

When testing local middleware changes, restart the HelpMe backend before
reopening the editor button. The LTI provider registers its launch callbacks at
startup, so an old process can return the previous JSON error response instead
of the question picker.

## Planned instructor sign-in flow

The intended Deep Linking experience removes the course-navigation setup step:

1. Canvas sends a signed Deep Linking launch to HelpMe.
2. HelpMe verifies the launch and saves short-lived resume state.
3. If the Canvas identity is not linked, HelpMe asks the instructor to sign in
   to an existing HelpMe account.
4. HelpMe verifies that the account is already a Professor or TA in the mapped
   course.
5. HelpMe links the verified Canvas issuer and user identifier to the account,
   then resumes the question picker.

If browser cookie restrictions prevent sign-in inside the Canvas iframe,
HelpMe should open the sign-in step in a top-level window and resume the picker
after authentication. The flow must not match by email, create accounts, or
change course roles.

## Availability evidence from local Canvas source

Question-level `availableFrom` and `availableUntil` settings were removed. An
instructor should not copy one quiz window into every embedded question, and
HelpMe and Canvas could disagree about the deadline.

HelpMe currently requests only `canvas_course_id` plus its own question ID. The
dynamic-registration `customParameters` carry only
`canvas_course_id: '$Canvas.course.id'`
(`packages/server/src/lti/lti.middleware.ts`), and the Deep Linking response
carries only `helpme_question_id`
(`packages/server/src/lti/lti.service.ts`). HelpMe does not request Canvas
deadline substitutions.

Local Canvas source shows resource and assignment dates are available only as
requested custom-variable substitutions guarded by assignment context. In
`lib/lti/variable_expander.rb`, `ResourceLink.available.endDateTime` expands
from `@assignment.lock_at` only when `@assignment && @assignment.lock_at` is
present, `Canvas.assignment.lockAt.iso8601` expands only when `@assignment &&
@assignment.lock_at` is present, and the shared `ASSIGNMENT_GUARD` is simply
`-> { @assignment }`. Without an assignment on the expander, these values stay
unexpanded.

A HelpMe resource link embedded inside Classic or New Quiz question content
follows the assignment-less external-tool retrieve path. In
`app/controllers/external_tools_controller.rb`, `retrieve` calls `lti_launch`
without an `assignment_id`, `lti_launch` carries an assignment reference only
from `secure_params`, and `basic_lti_launch_request` resolves its assignment
through `assignment_from_assignment_id` (from `params[:assignment_id]` or the
secure-params `lti_assignment_id`) before passing that possibly-nil assignment
to `variable_expander`. The New Quizzes quiz-level launch is separate: in
`app/controllers/new_quizzes_controller.rb`, `build_launch_data` and
`build_variable_expander` attach the quiz assignment to the quiz tool launch,
but that does not transfer assignment context to the nested HelpMe retrieve
launch.

Therefore the current placement should be assumed to provide no trusted
deadline until a real authenticated launch proves otherwise. Canvas controls
quiz visibility; HelpMe uses the 24-hour resource credential lifetime. Until
that behavior is verified, the options to discuss with the professor are, in
preferred order:

1. Cap the HelpMe resource token at the Canvas-signed resource or assignment
   deadline when Canvas supplies one.
2. If Canvas does not supply a deadline, let the instructor set one deadline for
   the whole HelpMe assessment instead of repeating it on every question.
3. If HelpMe has no trusted deadline, use a fixed token lifetime such as 24
   hours and rely on Canvas to control whether the quiz remains visible.

The second option needs an assessment-level record shared by the embedded
questions. If the professor requires HelpMe to enforce a deadline, prefer one
assessment-level HelpMe deadline shared across questions. Do not restore
per-question dates. When a token expires, the iframe must tell the student to
reopen the quiz in Canvas.

## Required tests before deadline enforcement

Live verification was blocked at Canvas login, so Classic/New Quiz launch
claims and per-student override behavior remain an explicit test item.

- Capture the verified LTI claims from the INDG quiz placement without logging
  names, email addresses, or tokens.
- Check whether classic quizzes and new quizzes supply a resource end time, an
  assignment lock time, both values, or neither value.
- Check whether Canvas applies each student's availability overrides to the
  launch value.
- If the launch has no deadline, test one assessment-level deadline across
  several embedded questions before using the fallback in production.
- Open a quiz again and confirm that Canvas performs a new LTI launch and HelpMe
  issues a new resource token.
- Keep one quiz tab open until its resource token expires and confirm that the
  next feedback request tells the student to reopen the Canvas quiz.
- If Canvas supplies a deadline, confirm that a copied token cannot request
  feedback after that deadline.

## Grading configuration

Authentication must remain independent of the INDG grading policy. A shared
grading profile can store the INDG system prompt, score range, and reason codes
for all questions that use that policy. The INDG capitalization check may stay
in code with a comment that explains why the course needs the check. Do not
infer the grading profile from a course name.
