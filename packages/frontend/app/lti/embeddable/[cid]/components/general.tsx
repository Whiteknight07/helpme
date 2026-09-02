import { Card } from 'antd'
import React, { useMemo } from 'react'
import { EmbeddableQuestion } from '@koh/common'

const dateFormat: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'short',
}

export const DateIssue: React.FC<{
  item: EmbeddableQuestion
  type: 'late' | 'early'
}> = ({ item, type }) => {
  const title = useMemo(
    () =>
      type === 'late'
        ? 'This Question has closed.'
        : 'This Question has not opened yet.',
    [type],
  )

  const text = useMemo(() => {
    return type === 'early'
      ? `This question is not available yet. It will become available after ${new Date(
          item.availableFrom ?? Date.now(),
        ).toLocaleDateString('en-US', dateFormat)}.`
      : `This question is no longer available. It closed after ${new Date(
          item.availableUntil ?? Date.now(),
        ).toLocaleDateString('en-US', dateFormat)}.`
  }, [item, type])

  return (
    <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
      <Card title={title}>
        <p className="font-bold text-zinc-400">{text}</p>
      </Card>
    </div>
  )
}

export const ErrorMessage: React.FC<{
  error?: string
  item?: EmbeddableQuestion
}> = ({ error }) => {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
      <Card title="Error loading Question">
        <p className="text-zinc-600">
          {error || 'Question not found.'} Please let your professor know.
        </p>
      </Card>
    </div>
  )
}
