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

## Availability is deferred

Question-level `availableFrom` and `availableUntil` settings were removed. An
instructor should not copy one quiz window into every embedded question, and
HelpMe and Canvas could disagree about the deadline.

Canvas supports launch substitutions for resource and assignment dates,
including `ResourceLink.available.endDateTime` and
`Canvas.assignment.lockAt.iso8601`. Canvas supplies assignment dates only when
the launch has an assignment context. We do not yet know whether the INDG quiz
placement supplies these values.

Until that behavior is verified, Canvas controls quiz availability. A later
implementation can cap the HelpMe resource token at a Canvas-signed deadline.
If the launch has no deadline, the resource token can use a fixed lifetime such
as 24 hours. When the token expires, the iframe must tell the student to reopen
the quiz in Canvas.

## Required tests before deadline enforcement

- Capture the verified LTI claims from the INDG quiz placement without logging
  names, email addresses, or tokens.
- Check whether classic quizzes and new quizzes supply a resource end time, an
  assignment lock time, both values, or neither value.
- Check whether Canvas applies each student's availability overrides to the
  launch value.
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
