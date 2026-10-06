# Canvas grading evaluation handoff

For grading evaluation. Use these branch revisions:

- HelpMe: `/Users/stavan/projects/helpme-canvas-batch-review`,
  `stavan/canvas-batch-grading`, the commit containing this handoff
  (rebased onto `origin/main` at `fe06436d` on October 5, 2026).
- Chatbot: `/Users/stavan/projects/chatbot`,
  `stavan/canvas-batch-feedback`
  (rebased onto `origin/main` at `e2acdd0` on October 5, 2026).

Chatbot owns the system prompt. HelpMe sends question-specific values, the
allowed scores, effective cap, and triggered checks. The INDG replay imports both
builders directly, so it uses the batch branches' current prompt rather than a
copied LTI prompt. Both parent features have merged into their repositories'
`main`; the batch branches contain the follow-up work.

## Request contract

Send `POST /chat/chatbot/query` with the configured `HMS-API-KEY` header. If the
service URL already ends in `/chat`, append `/chatbot/query` only.

```json
{
  "type": "feedback",
  "courseId": 12,
  "query": "## Student answer\n\n\"...\"",
  "params": {
    "grading": {
      "questionText": "Instructor's question",
      "mechanicalFacts": "{\"sentence_count\":3}",
      "rubric": "Configured rubric",
      "feedbackInstructions": "Feedback instructions, or the frozen final instruction in batch",
      "humanReviewCriteria": "Configured criteria, or empty",
      "scoreContract": "Allowed scores: 0, 0.5, 1, 1.5, 2. Full rubric credit is 2. If no rubric criterion warrants a deduction, select 2. Do not select a lower score without a specific rubric-backed deduction supported by the student answer.",
      "capContract": "",
      "automaticChecks": ""
    }
  }
}
```

In batch (final) grading, `feedbackInstructions` carries the run's frozen final
instruction instead of the question's feedback instructions. Practice feedback
sends the question's own feedback instructions. Malformed structured inputs and
mixed `grading`/`systemPrompt` requests are rejected. Legacy `params.systemPrompt`
remains accepted for the current LTI caller.

HelpMe rejects answers over 15,000 characters before a model call. Chatbot rejects
structured grading fields over 15,000 characters. Neither service truncates
grading input. Batch Canvas access requires an instructor API token, not OAuth.

Chatbot uses the course-selected feedback model. The response is
`{ "answer": { "score": 1.5, "comment": "...", "reasons": ["..."],
"human_review_reason": null }, "model": "..." }`.

## Evaluation entry point

Use `QuestionGradingService.evaluate()` in the batch checkout for end-to-end
grading evaluation without Canvas writes. Supply `courseId`, `questionText`,
`gradingSettings`, `submission`, `gradingMode: 'final'`, and the frozen
`finalInstruction`. This calls chatbot, validates its answer against the score
scale and any triggered cap, and returns the evaluation without persisting it. Do not invoke the batch
runner or Canvas grade-writing endpoint for this evaluation.

Direct chatbot requests evaluate model behavior only. They do not run HelpMe's
blank-answer bypass, score validation, or persistence. As on the LTI branch,
HelpMe rejects a score above a triggered cap rather than lowering it.

Evaluate configured review criteria, no configured criteria, ordinary answers,
and instruction-like student answers using the intended course model. Keep INDG
policy in the supplied rubric, feedback instructions, or human review criteria. Unit tests establish the
request boundary and message roles, not how a live model handles malicious text.
Private prompts do not establish prompt-injection resistance.

Deployment order and failure recovery are in
[the local Canvas guide](LOCAL_CANVAS_SETUP.md#feedback-deployment-and-failures).

Feedback requests have a three-minute deadline, including chatbot provider retries.
On timeout, HelpMe records a grading failure and continues with other attempts;
no grades are written for the failed attempt. The remote model may continue
working after HelpMe stops waiting.

## Verification

The targeted HelpMe suites cover grading validation, input limits, API-token-only
Canvas access, unknown write outcomes, crash recovery, and review comments.
Chatbot's `types.spec.ts` and `chatbot.query-isolated.spec.ts` cover its request
boundary and model messages. The INDG `analysis/eval/grade.spec.ts` compares the
rendered replay prompts with the real HelpMe grading service in final and practice
modes without making model calls.

The database check uses the repository's shared `TestTypeOrmModule` and standard
`test` database configuration (`POSTGRES_NONROOT_USER` and
`POSTGRES_NONROOT_PASSWORD`), like the existing LTI service tests:

```bash
cd packages/server
yarn test:integration --runTestsByPath test/canvas-batch-store.integration.ts
```

It verifies that concurrent workers cannot process the same run and that a failed
worker releases its lock. Batch migration round trips were checked separately.
