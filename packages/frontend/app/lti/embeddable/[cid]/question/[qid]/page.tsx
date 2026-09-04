'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card } from 'antd'
import CenteredSpinner from '@/app/components/CenteredSpinner'
import { type EmbeddableQuestion } from '@koh/common'
import { API } from '@/app/api'
import EmbeddableQuestionFeedback from '@/app/lti/embeddable/[cid]/components/EmbeddableQuestionFeedback'

type QuestionState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; question: EmbeddableQuestion }

export default function EmbeddableQuestionPage() {
  const routeParams = useParams<{ cid: string; qid: string }>()
  const [questionState, setQuestionState] = useState<QuestionState>({
    status: 'loading',
  })

  const courseId = Number(routeParams.cid)
  const questionId = Number(routeParams.qid)
  const hasInvalidRoute = !questionId || !courseId

  useEffect(() => {
    if (hasInvalidRoute) return

    // Reset stale data when navigating between questions without a remount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuestionState({ status: 'loading' })
    API.lti.embeddableQuestion
      .getOne(courseId, questionId)
      .then((question) => setQuestionState({ status: 'ready', question }))
      .catch(() =>
        setQuestionState({
          status: 'error',
          error: 'Could not load question. It may have been deleted.',
        }),
      )
  }, [courseId, hasInvalidRoute, questionId])

  if (hasInvalidRoute) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
        <Card title="Error loading Question">
          <p className="text-zinc-600">
            Invalid course or question ID. Please let your professor know.
          </p>
        </Card>
      </div>
    )
  }

  if (questionState.status === 'loading') {
    return <CenteredSpinner tip="Loading..." />
  }

  if (questionState.status === 'error') {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
        <Card title="Error loading Question">
          <p className="text-zinc-600">
            {questionState.error} Please let your professor know.
          </p>
        </Card>
      </div>
    )
  }

  const { question } = questionState
  return (
    <>
      <title>HelpMe | Embeddable Question</title>
      <div className="flex w-full flex-col items-stretch px-2 py-1">
        <EmbeddableQuestionFeedback
          courseId={courseId}
          questionId={question.id}
          questionText={question.questionText}
        />
      </div>
    </>
  )
}
