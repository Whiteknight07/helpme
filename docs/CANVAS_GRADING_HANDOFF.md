# Canvas grading evaluation handoff

For the INDG evaluation agent. Use the branch revisions containing this review fix:

- HelpMe: `/Users/stavan/projects/helpme-canvas-batch-review`,
  `stavan/canvas-batch-grading`, the commit containing this handoff
  (based on `8d9fc5ac`).
- Chatbot: `/Users/stavan/projects/chatbot`,
  `stavan/canvas-batch-feedback`, `c82d3c2`
  (based on `stavan/structured-feedback-query` at `5c0dbd3`).
- LTI comparison only: `/Users/stavan/projects/helpme`,
  `stavan/lti-deep-linking`, `4e0f455d`. This checkout was left untouched.

The applicable changes from `4e0f455d` are incorporated in this review fix:
instructor question in the system message, configured human-review criteria,
free-form reasons, setup documentation, and the integration uniqueness comment.
Batch retains its own mechanical checks and post-grading caps.

## Request contract

Send `POST /chat/chatbot/query` with the configured `HMS-API-KEY` header. If the
service URL already ends in `/chat`, append `/chatbot/query` only.

```json
{
  "type": "feedback",
  "courseId": 12,
  "query": "Only the student's answer",
  "params": {
    "grading": {
      "questionText": "Instructor's question",
      "rubric": "Configured rubric, including any human-review criteria",
      "feedbackInstructions": "Configured feedback instructions",
      "scoreScale": { "max": 2, "step": 0.5 },
      "finalInstruction": "The exact instruction frozen on the batch run"
    }
  }
}
```

`finalInstruction` is optional for practice; batch sends the frozen run instruction.
`feedbackInstructions` may be empty. The question and rubric must be nonblank;
the scale must have positive finite values and a maximum divisible by its step.
Malformed structured inputs and mixed `grading`/`systemPrompt` requests are rejected.
Legacy `params.systemPrompt` remains accepted for the current LTI caller.

Chatbot constructs the system message from `grading` and sends `query` alone as
the user message. It uses the course-selected feedback model. The response is
`{ "answer": { "score": 1.5, "comment": "...", "reasons": ["..."],
"human_review_reason": null }, "model": "..." }`. The review reason must be a
non-empty explanation string when the configured criteria apply, otherwise null.
Reasons are free-form; there are no shared INDG rules or examples.

## Evaluation entry point

Use `QuestionGradingService.evaluate()` in the batch checkout for end-to-end
grading evaluation without Canvas writes. Supply `courseId`, `questionText`,
`gradingSettings`, `submission`, `gradingMode: 'final'`, and the frozen
`finalInstruction`. This calls chatbot, validates its answer, applies mechanical
caps, and returns the evaluation without persisting it. Do not invoke the batch
runner or Canvas grade-writing endpoint for this evaluation.

Direct chatbot requests evaluate model behavior only. They do not run HelpMe's
blank-answer bypass, score-grid validation, mechanical checks, caps, or persistence.
In batch, a valid model score above a triggered cap is accepted and reduced by
code. The LTI checkout instead tells the model about the effective cap and rejects
above-cap scores. Use the batch checkout to measure batch behavior.

Evaluate configured review criteria, no configured criteria, ordinary answers,
and instruction-like student answers using the intended course model. Keep INDG
policy in the supplied rubric or feedback instructions. Unit tests establish the
request boundary and message roles, not how a live model handles malicious text.
Private prompts do not establish prompt-injection resistance.

Deployment order and failure recovery are in
[the local Canvas guide](LOCAL_CANVAS_SETUP.md#feedback-deployment-and-failures).

## Verification

Passed: 42 targeted HelpMe tests across `grading-utils`, `question-grading.service`,
`chatbot-api.service`, `lmsIntegration.adapter`, `canvas-batch-runner.service`, and
`canvas-batch.service`; 42 chatbot tests in `types.spec.ts` and
`chatbot.query-isolated.spec.ts`; TypeScript checks for both servers and HelpMe's
frontend. Tests inspect requests, validation results, applied caps, saved failure
reports, and write counts. They do not evaluate a live model.

The existing `lmsIntegration.service.spec.ts` suite could not initialize because
local PostgreSQL/Redis and test environment configuration were unavailable. The
new migration has not been applied to a database. No live Canvas grades were
written, and no changes were deployed.
