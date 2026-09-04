# LTI embedded question authentication

This note records the authentication and deadline questions found while adding
Canvas Deep Linking for embeddable questions. The current branch does not solve
these questions yet.

## Launches and later requests are different

Canvas starts an LTI launch when it loads a linked HelpMe question. Canvas sends
a signed ID token to the HelpMe launch endpoint. The LTI middleware verifies the
token before HelpMe trusts the Canvas user, role, course, and resource link.

HelpMe then redirects the iframe to the question page. Requests from that page
come from browser JavaScript. Canvas does not sign the later question and
feedback API requests. HelpMe therefore needs a post-launch credential. The
proposed credential is a HelpMe-signed JWT limited to the mapped course and
question. It must not create or represent a normal HelpMe account or course
enrollment.

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
