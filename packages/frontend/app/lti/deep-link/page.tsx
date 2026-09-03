'use client'

import { ReactElement, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Alert, Button, Card, Radio, Typography } from 'antd'
import { EmbeddableQuestion } from '@koh/common'
import { API } from '@/app/api'
import CenteredSpinner from '@/app/components/CenteredSpinner'
import { getErrorMessage } from '@/app/utils/generalUtils'

const { Paragraph, Text } = Typography

export default function DeepLinkPage(): ReactElement {
  const searchParams = useSearchParams()
  const ltik = searchParams.get('ltik') ?? ''
  const [questions, setQuestions] = useState<EmbeddableQuestion[]>()
  const [selectedId, setSelectedId] = useState<number>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!ltik) {
      return
    }
    API.lti.deepLink
      .getQuestions(ltik)
      .then(setQuestions)
      .catch((err: unknown) => setError(String(getErrorMessage(err))))
  }, [ltik])

  if (!ltik) {
    return (
      <div className="flex w-full justify-center px-2 py-6">
        <Alert
          type="error"
          message="Could not open the question picker"
          description="This page must be opened from Canvas."
          showIcon
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex w-full justify-center px-2 py-6">
        <Alert
          type="error"
          message="Could not open the question picker"
          description={error}
          showIcon
        />
      </div>
    )
  }

  if (!questions) {
    return <CenteredSpinner tip="Loading questions..." />
  }

  if (questions.length === 0) {
    return (
      <div className="flex w-full justify-center px-2 py-6">
        <Alert
          type="info"
          message="No questions to insert"
          description="This course has no embeddable questions yet. Create one in the HelpMe course settings first."
          showIcon
        />
      </div>
    )
  }

  return (
    <>
      <title>HelpMe | Insert question</title>
      <div className="flex w-full justify-center px-2 py-4">
        <Card title="Insert HelpMe question" className="w-full max-w-2xl">
          <Paragraph>
            Select a question to insert into Canvas. Students will open it
            without a HelpMe login.
          </Paragraph>
          {/* Native POST so the signed response document auto-submits to Canvas */}
          <form method="POST" action={API.lti.deepLink.selectAction(ltik)}>
            <input type="hidden" name="questionId" value={selectedId ?? ''} />
            <Radio.Group
              className="flex w-full flex-col gap-2"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {questions.map((q) => (
                <Radio key={q.id} value={q.id}>
                  <Text strong>{q.name ?? `Question ${q.id}`}</Text>
                  <Paragraph
                    ellipsis={{ rows: 2 }}
                    type="secondary"
                    className="mb-0"
                  >
                    {q.questionText}
                  </Paragraph>
                </Radio>
              ))}
            </Radio.Group>
            <Button
              type="primary"
              htmlType="submit"
              disabled={selectedId === undefined}
              className="mt-4"
            >
              Insert into Canvas
            </Button>
          </form>
        </Card>
      </div>
    </>
  )
}
