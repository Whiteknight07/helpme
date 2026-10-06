# Canvas batch grading handoff for Adam

Reviewed October 5, 2026. The Classic Quiz batch grading flow is implemented and
has a recorded local Canvas rehearsal. It is ready for maintainer review and
staging validation. Grading quality still needs instructor approval before use
on real student marks.

## Branches and dependencies

- HelpMe: `stavan/canvas-batch-grading`, tracked on the `Whiteknight07/helpme`
  fork. Rebased onto `ubco-db/helpme` main at `fe06436d`.
- Chatbot: `stavan/canvas-batch-feedback` in `ubco-db/chatbot`. Rebased onto
  main at `e2acdd0`.
- The parent PRs, HelpMe #581 and chatbot #72, are already merged. Merge the
  remaining batch changes against main, rather than reopening the parent work.
- No batch PR existed in either upstream repository when this review started.
  Rebasing rewrote both branch histories; existing checkouts need to account for
  that before pulling. Local backup branches and pre-rebase stashes were kept.

Both checkouts had uncommitted follow-up changes when this review started.
These include interrupted-write recovery, token-only batch access, UI recovery
messages, sentence counting, and input limits. Those changes belong in the
handoff alongside the earlier batch commits.

## What the feature does

A professor or TA opens Course Settings → Canvas Batch Grading, selects a
published Classic Quiz, and starts grading. Every essay question must resolve
to exactly one HelpMe question through its Canvas LTI resource link. Reusing the
same HelpMe question twice, cross-course mappings, mismatched maximum points,
invalid grading settings, and automatic grade posting block a new run.
Other question types are left to Canvas.

The run freezes the question text, rubric, score scale, automatic checks, review
criteria, mapping, and final grading instruction. It discovers completed
attempts from the quiz submission list and assignment submission data/history.
It excludes excused and already posted attempts. Any existing essay score or
grader comment causes the whole attempt to be skipped, so it does not partially
overwrite an instructor's grading.

The worker grades each mapped answer and validates every result before sending
one request containing all essay scores/comments for that attempt. A missing
answer or invalid grade prevents that attempt's write; other attempts continue.
An explicitly blank answer gets zero and "No answer was submitted." without a
model call. Answers over 15,000 characters fail without truncation.

HelpMe prefills SpeedGrader and never releases grades. Staff review the report
and SpeedGrader, then post grades in Canvas. A completed run can still contain
attempt errors, so check the report rather than treating completion as success
for every student.

## What belongs to each service

HelpMe owns Canvas access, frozen grading settings, deterministic sentence and
capitalization checks, score/cap validation, durable runs/attempts, the queue,
and the staff page. Batch grading uses a fixed final instruction in place of the
question's practice feedback instructions. The shared practice grading path
also changes to use the structured chatbot request.

Chatbot owns the common system prompt, course-selected provider/model,
structured response schema, and provider retries. Its sister branch adds
`params.grading`, builds a course-neutral prompt from those values, keeps the
answer in a separate user message, and limits each grading field to 15,000
characters. The legacy `params.systemPrompt` contract remains supported for
rollout. A request containing both contracts is rejected.

The response contains a score, student comment, explanation reasons, nullable
human review reason, and model provenance. Chatbot validates shape; HelpMe
checks whether the score is allowed and within the effective cap. A score above
a cap is an error, not silently reduced. HelpMe allows three minutes for the
whole feedback request. A remote provider can continue after that deadline.

## Operational constraints

- Use an instructor Canvas API token saved in LMS Integrations. OAuth-only
  connections cannot batch grade; this branch preserves document-sync OAuth
  scopes rather than adding batch write scopes.
- Set manual grade posting before submissions. Do not edit the quiz, grade it,
  or post grades while a run is active. Eligibility is checked at intake; there
  is deliberately no second Canvas check immediately before each write.
- A flagged answer adds one "REVIEW REQUIRED (HelpMe AI)" submission comment.
  Delete it after review and before posting: students can see it once posted.
  Technical errors remain in the HelpMe report rather than creating comments.
- Canvas writes are not retried. Timeouts, HTTP 408, server/proxy failures, and
  worker interruptions can leave an unknown outcome. Check SpeedGrader before
  starting another run. If the grades exist but a review comment is missing,
  add the reasons manually instead of regrading.
- A durable `writing` marker prevents a resumed worker from replaying a request
  whose outcome was not saved. A PostgreSQL advisory lock excludes duplicate
  workers for the same run. Each active run holds a database connection; keep
  the pool larger than the active worker count and stop old workers on deploy.
- There is one job type and concurrency is one per worker. No cancel or
  grade-release endpoint is implemented. New Quizzes are outside this scope.

## Verification and evidence

After the rebases, the seven targeted HelpMe suites passed: 73 tests covering
batch services, grading, checks, the Canvas adapter, and chatbot API calls.
Chatbot's two relevant suites passed: 51 tests. HelpMe common/server/frontend and
chatbot TypeScript checks passed. The INDG replay parity check passed both tests
for final/practice prompts and blank/oversized answers without model calls.

The separate INDG checkout records an October 1 local rehearsal in
`analysis/eval/batch-demo-20261001.md`: run 29 processed three attempts and
prefilled 15 question scores/comments without errors or skips. Totals were
10/10, 9/10, and 0/10. The record says SpeedGrader showed Hidden, `posted_at`
remained null, and student API responses omitted scores. Three authenticated
practice requests were also checked. This is prior recorded evidence, not a
fresh live verification of the rebased code.

The additional LMS service suite could not initialize because PostgreSQL and
Redis were unavailable. Docker was stopped during this review, so database
integration, migration round trips, full integration tests, and live Canvas
behavior were not rerun.
The advisory-lock integration test is included in this branch. Run it with the
standard test database credentials:

```sh
cd packages/server
yarn test:integration --runTestsByPath test/canvas-batch-store.integration.ts
```

Evaluation artifacts live in the separate local INDG checkout, not in these
branches. Arrange access to the aggregate reports and approved rubric/settings
snapshots; avoid copying historical student answers into a code PR.

## What remains

1. Review and publish the two batch branches/PRs together. Deploy chatbot first,
   then apply HelpMe's `CanvasBatchGrading1789763948908` and
   `CanvasBatchRunError1790080000000` migrations and deploy HelpMe. Roll back
   HelpMe first. Keep legacy prompt support until every caller has migrated.
2. Run database/migration and full integration checks in CI or a running local
   environment. Repeat the Canvas rehearsal on the rebased code and the target
   Canvas instance. Include multiple attempts, mixed question types, blanks,
   malformed/missing history, existing zero grades, posted/excused attempts,
   human-review comments, rejected writes, and interruption/resume.
3. Obtain instructor sign-off on the rubric/model combination. The October 1
   1,000-answer replay produced 993 valid results and 7 rejected cap violations;
   692 matched historical scores exactly. The completion question matched only
   13 of 200 historical marks and averaged 1.54 points lower on a two-point
   scale. The question/rubric had changed to require an explanation, so this
   comparison mixes policy change with model behavior. Decide whether that
   stricter policy is intended before using it on current students.
4. Later focused records report 214/214 final-prompt cases, 35/35 holdout cases,
   and a final audit of 891/891 evaluations. Those records do not replace the
   broad historical comparison or establish general resistance to instructions
   embedded in student answers. Re-evaluate approved settings with the deployed
   course model; rubric changes belong in course configuration, and general
   prompt changes belong in chatbot's sister branch.

There is no obvious missing core endpoint or screen for the agreed Classic Quiz
flow. Remaining engineering work depends on the checks above. Strong candidates
for additional regression coverage are pagination and multiple-attempt history,
the real database's concurrent run creation, and staff HTTP authorization. The
existing tests cover the worker's write recovery but do not establish all of
those boundaries. Cancellation, New Quizzes, parallel throughput, and automatic
posting would be separate feature decisions.

## Code entry points

- `packages/common/canvas-batch-grading.ts`: shared states and frozen final instruction.
- `packages/server/src/lti/embeddable/canvas-batch/`: controller, service, store, worker, entities.
- `packages/server/src/lmsIntegration/lmsIntegration.adapter.ts`: Classic Quiz transport and mapping.
- `packages/server/src/lti/embeddable-question/`: shared grading/checks and score validation.
- `packages/frontend/app/(dashboard)/course/[cid]/(settings)/settings/canvas_batch_grading/page.tsx`: staff workflow.
- Chatbot `src/types.ts`, `src/chatbot/chatbot.controller.ts`, and
  `src/chatbot/chatbot.service.ts`: request boundary, system prompt, and model call.

See [the local Canvas setup guide](LOCAL_CANVAS_SETUP.md) for setup/recovery and
[the grading contract](CANVAS_GRADING_HANDOFF.md) for evaluation requests.
