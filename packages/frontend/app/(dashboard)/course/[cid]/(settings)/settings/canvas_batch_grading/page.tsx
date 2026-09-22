'use client'

import { use, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  Alert,
  Button,
  Card,
  Progress,
  Select,
  Space,
  Tag,
  message,
} from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import useSWR from 'swr'
import useSWRImmutable from 'swr/immutable'
import { CanvasBatchRunStatus } from '@koh/common'
import { API } from '@/app/api'
import { getErrorMessage } from '@/app/utils/generalUtils'

const POLL_INTERVAL_MS = 3000

export default function CanvasBatchGradingPage({
  params,
}: {
  params: Promise<{ cid: string }>
}): ReactElement {
  const courseId = Number(use(params).cid)
  const [selectedQuizId, setSelectedQuizId] = useState<number>()
  const [activeRunId, setActiveRunId] = useState<number>()
  const [starting, setStarting] = useState(false)

  const quizzesRequest = useSWRImmutable(
    `canvasBatch/quizzes/${courseId}`,
    () => API.lti.canvasBatch.getQuizzes(courseId),
  )
  const runsRequest = useSWRImmutable(`canvasBatch/runs/${courseId}`, () =>
    API.lti.canvasBatch.getRuns(courseId),
  )
  const quizzes = quizzesRequest.data ?? []
  const runs = runsRequest.data ?? []
  const selectedQuiz = useMemo(
    () => quizzes.find((quiz) => quiz.canvasQuizId === selectedQuizId),
    [quizzes, selectedQuizId],
  )
  const latestRun = useMemo(
    () => runs.find((run) => run.canvasQuizId === selectedQuizId),
    [runs, selectedQuizId],
  )

  useEffect(() => setActiveRunId(latestRun?.id), [latestRun?.id])

  const reportRequest = useSWR(
    activeRunId ? `canvasBatch/report/${courseId}/${activeRunId}` : null,
    () => API.lti.canvasBatch.getReport(courseId, activeRunId as number),
    {
      refreshInterval: (report) =>
        report?.run.status === CanvasBatchRunStatus.Running
          ? POLL_INTERVAL_MS
          : 0,
    },
  )
  const report =
    reportRequest.data?.run.canvasQuizId === selectedQuizId
      ? reportRequest.data
      : undefined
  const run = report?.run
  const isFailed = run?.status === CanvasBatchRunStatus.Failed
  const isRunning = run?.status === CanvasBatchRunStatus.Running
  const isResuming = run
    ? isRunning
    : latestRun?.status === CanvasBatchRunStatus.Running
  const questionCount = selectedQuiz?.essayQuestions.length ?? 0
  const blockingReason = !selectedQuiz
    ? null
    : questionCount === 0
      ? 'This Canvas quiz has no essay questions.'
      : !selectedQuiz.postManually
        ? 'Set this assignment to manually post grades in Canvas, then reload this page.'
        : selectedQuiz.mappingError
  const canStart =
    selectedQuiz != null &&
    selectedQuiz.postManually &&
    (isResuming || blockingReason == null)

  const start = async () => {
    if (!selectedQuiz) return
    setStarting(true)
    try {
      const started = await API.lti.canvasBatch.startRun(courseId, {
        canvasQuizId: selectedQuiz.canvasQuizId,
      })
      setActiveRunId(started.id)
      message.success(
        isResuming
          ? 'Grading resumed.'
          : 'Grading started. HelpMe is prefilling SpeedGrader.',
      )
      void runsRequest.mutate()
    } catch (error) {
      message.error(`Failed to start grading: ${getErrorMessage(error)}`)
    } finally {
      setStarting(false)
    }
  }

  const counts = run?.counts
  const flags = report?.flags ?? []
  const total = counts?.questions ?? 0
  const percent = total
    ? Math.round(((total - (counts?.pending ?? 0)) / total) * 100)
    : 0
  const loadError = quizzesRequest.error ?? runsRequest.error

  return (
    <Card title="Canvas Batch Grading" classNames={{ body: 'p-3 md:p-6' }}>
      <p className="mb-4 text-gray-600">
        Select a Classic Canvas quiz. HelpMe detects its embedded questions and
        prefills SpeedGrader; you review and post grades in Canvas.
      </p>
      <Alert
        className="mb-4"
        type="warning"
        showIcon
        message="Do not edit or post this quiz while prefill is running."
      />

      {loadError && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="Failed to load Canvas quizzes"
          description={getErrorMessage(loadError)}
        />
      )}

      <label className="mb-2 block font-medium" htmlFor="canvas-batch-quiz">
        Canvas quiz
      </label>
      <Select
        id="canvas-batch-quiz"
        className="mb-4 w-full md:max-w-xl"
        placeholder="Select a Classic Canvas quiz"
        value={selectedQuizId}
        onChange={setSelectedQuizId}
        loading={quizzesRequest.isLoading}
        showSearch
        optionFilterProp="label"
        options={quizzes.map((quiz) => ({
          value: quiz.canvasQuizId,
          label: `${quiz.title} (${quiz.essayQuestions.length} essay ${
            quiz.essayQuestions.length === 1 ? 'question' : 'questions'
          })`,
        }))}
      />

      {selectedQuiz && (
        <>
          {blockingReason ? (
            <Alert
              className="mb-4"
              type="error"
              showIcon
              message="This quiz is not ready"
              description={blockingReason}
            />
          ) : (
            <Alert
              className="mb-4"
              type="success"
              showIcon
              message={`${selectedQuiz.detectedQuestions} of ${questionCount} HelpMe questions detected from Canvas.`}
            />
          )}

          <Space wrap>
            <Button
              type="primary"
              onClick={start}
              loading={starting}
              disabled={!canStart}
            >
              {isResuming ? 'Resume grading' : 'Grade and prefill SpeedGrader'}
            </Button>
            <Button
              icon={<ExportOutlined />}
              href={selectedQuiz.speedGraderUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open SpeedGrader
            </Button>
          </Space>
        </>
      )}

      {run && (
        <div className="mt-6 border-t pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Tag color={isRunning ? 'processing' : undefined}>
              {isRunning
                ? 'Prefilling SpeedGrader'
                : isFailed
                  ? 'Prefill failed'
                  : 'Prefill complete'}
            </Tag>
            <span className="text-gray-500" role="status" aria-live="polite">
              {counts
                ? `${counts.attempts} attempts · ${counts.posted} responses prefilled · ${counts.pending} pending · ${counts.skipped} skipped · ${counts.flagged} flagged · ${counts.errors} errors`
                : 'Loading progress…'}
            </span>
          </div>
          <Progress
            percent={percent}
            status={isRunning ? 'active' : isFailed ? 'exception' : 'success'}
            aria-label="SpeedGrader prefill progress"
          />
          {run.error && (
            <Alert
              className="mt-4"
              type="error"
              showIcon
              message="Prefill failed"
              description={run.error}
            />
          )}
          {report.errors.length > 0 && (
            <Alert
              className="mt-4"
              type="error"
              showIcon
              message="Some items need attention before you post grades"
              description={
                <ul className="list-disc pl-5">
                  {report.errors.map((record) => (
                    <li
                      key={`${record.quizSubmissionId}-${record.attemptNumber}-${record.source}-${record.canvasQuestionId ?? ''}`}
                    >
                      Submission {record.quizSubmissionId}, attempt{' '}
                      {record.attemptNumber}
                      {record.source === 'question'
                        ? `, question ${record.position}`
                        : ''}
                      :{' '}
                      {record.error?.trim() ||
                        'Canvas prefill did not complete.'}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          {flags.length > 0 && (
            <Alert
              className="mt-4"
              type="warning"
              showIcon
              message="Some responses were flagged for review"
              description={
                <ul className="list-disc pl-5">
                  {flags.map((flag) => (
                    <li
                      key={`${flag.quizSubmissionId}-${flag.attemptNumber}-${flag.canvasQuestionId}`}
                    >
                      Submission {flag.quizSubmissionId}, attempt{' '}
                      {flag.attemptNumber}, question {flag.position}:{' '}
                      {flag.reason}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </div>
      )}
    </Card>
  )
}
