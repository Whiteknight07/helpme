'use client'

import { API } from '@/app/api'
import type { StaffChatbotAgentCourse } from '@koh/common'
import { Select } from 'antd'
import { ReactElement, useEffect, useState } from 'react'

interface ChatbotAgentTargetSelectProps {
  courseId: number
  value: number
  onChange: (courseId: number) => void
}

export default function ChatbotAgentTargetSelect({
  courseId,
  value,
  onChange,
}: ChatbotAgentTargetSelectProps): ReactElement | null {
  const [agents, setAgents] = useState<StaffChatbotAgentCourse[]>([])

  useEffect(() => {
    let active = true

    API.chatbot.staffOnly
      .getAgentsForStaff(courseId)
      .then((response) => {
        if (active) {
          setAgents(response)
        }
      })
      .catch((e) => {
        console.error(e)
        if (active) {
          setAgents([])
        }
      })

    return () => {
      active = false
    }
  }, [courseId])

  if (agents.length === 0) {
    return null
  }

  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="font-medium text-gray-700">Managing:</span>
      <Select
        className="min-w-[260px]"
        value={value}
        onChange={onChange}
        options={[
          { label: 'Course chatbot (default)', value: courseId },
          ...agents.map((agent) => ({
            label: `${agent.agentName}${agent.enabled ? '' : ' (disabled)'}`,
            value: agent.courseId,
          })),
        ]}
      />
    </div>
  )
}
