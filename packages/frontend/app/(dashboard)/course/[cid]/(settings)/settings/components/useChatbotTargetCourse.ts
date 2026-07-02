'use client'

import { useEffect, useState } from 'react'

export function useChatbotTargetCourse(
  courseId: number,
): [number, (id: number) => void] {
  const [targetCourseId, setTargetCourseId] = useState(courseId)

  useEffect(() => {
    setTargetCourseId(courseId)
  }, [courseId])

  return [targetCourseId, setTargetCourseId]
}
