'use client'

import React, { ReactElement, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card } from 'antd'
import CenteredSpinner from '@/app/components/CenteredSpinner'
import { EmbeddableQuestion } from '@koh/common'
import { API } from '@/app/api'
import EmbeddableQuestionFeedback from '@/app/lti/embeddable/[cid]/components/EmbeddableQuestionFeedback'

const dateFormat: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'short',
}

type QuestionState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; question: EmbeddableQuestion }

export default function EmbeddableQuestionPage(): ReactElement {
  const routeParams = useParams<{ cid: string; qid: string }>()
  const [questionState, setQuestionState] = useState<QuestionState>({
    status: 'loading',
  })

  const courseId = Number(routeParams?.cid)
  const questionId = Number(routeParams?.qid)

  useEffect(() => {
    if (
      !questionId ||
      !courseId ||
      Number.isNaN(questionId) ||
      Number.isNaN(courseId)
    ) {
      setQuestionState({
        status: 'error',
        error: 'Invalid course or question ID',
      })
      return
    }

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
  }, [courseId, questionId])

  if (questionState.status === 'loading') {
    return <CenteredSpinner tip="Loading..." />
  }

  if (questionState.status === 'error') {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
        <Card title="Error loading Question">
          <p className="text-zinc-600">
            {questionState.error || 'Question not found.'} Please let your
            professor know.
          </p>
        </Card>
      </div>
    )
  }

  const { question } = questionState
  const isOpen =
    !question.availableFrom ||
    new Date(question.availableFrom).getTime() <= Date.now()
  const isClosed =
    !!question.availableUntil &&
    new Date(question.availableUntil).getTime() < Date.now()

  if (!isOpen || isClosed) {
    const isEarly = !isOpen
    const title = isEarly
      ? 'This Question has not opened yet.'
      : 'This Question has closed.'
    const text = isEarly
      ? `This question is not available yet. It will become available after ${new Date(
          question.availableFrom ?? Date.now(),
        ).toLocaleDateString('en-US', dateFormat)}.`
      : `This question is no longer available. It closed after ${new Date(
          question.availableUntil ?? Date.now(),
        ).toLocaleDateString('en-US', dateFormat)}.`

    return (
      <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
        <Card title={title}>
          <p className="font-bold text-zinc-400">{text}</p>
        </Card>
      </div>
    )
  }

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
