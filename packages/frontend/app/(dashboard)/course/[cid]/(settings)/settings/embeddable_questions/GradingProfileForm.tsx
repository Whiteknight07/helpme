'use client'

import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button, Card, Form, Input, Select, Tooltip, message } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import {
  GENERIC_DEFAULT_ALLOWED_SCORES,
  GENERIC_DEFAULT_REASON_CODES,
  GENERIC_DEFAULT_SYSTEM_PROMPT,
  INDG_DEFAULT_ALLOWED_SCORES,
  INDG_DEFAULT_REASON_CODES,
  INDG_DEFAULT_SYSTEM_PROMPT,
  type GradingPolicyKind,
  type UpsertGradingProfileParams,
} from '@koh/common'
import { API } from '@/app/api'
import { getErrorMessage } from '@/app/utils/generalUtils'

type ProfileFormValues = Omit<
  UpsertGradingProfileParams,
  'allowedScores' | 'reasonCodes'
> & {
  allowedScores: string
  reasonCodes: string
}

export default function GradingProfileForm({
  courseId,
}: {
  courseId: number
}): ReactElement {
  const [form] = Form.useForm<ProfileFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const policyKind = Form.useWatch('policyKind', form)
  const isIndg = policyKind === 'indg-reflection'

  const fetchProfile = useCallback(async () => {
    try {
      const profile = await API.lti.embeddableQuestion.getProfile(courseId)
      form.setFieldsValue({
        policyKind: profile.policyKind,
        systemPrompt: profile.systemPrompt,
        allowedScores: profile.allowedScores.join(', '),
        reasonCodes: profile.reasonCodes.join(', '),
      })
    } catch (err) {
      message.error(`Failed to load grading profile: ${getErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }, [courseId, form])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handlePolicyChange = (value: GradingPolicyKind) => {
    if (value === 'indg-reflection') {
      form.setFieldsValue({
        systemPrompt: INDG_DEFAULT_SYSTEM_PROMPT,
        allowedScores: INDG_DEFAULT_ALLOWED_SCORES.join(', '),
        reasonCodes: INDG_DEFAULT_REASON_CODES.join(', '),
      })
    } else {
      form.setFieldsValue({
        systemPrompt: GENERIC_DEFAULT_SYSTEM_PROMPT,
        allowedScores: GENERIC_DEFAULT_ALLOWED_SCORES.join(', '),
        reasonCodes: GENERIC_DEFAULT_REASON_CODES.join(', '),
      })
    }
  }

  const handleSave = async (values: ProfileFormValues) => {
    if (saving) return
    setSaving(true)
    try {
      const updated = await API.lti.embeddableQuestion.updateProfile(courseId, {
        policyKind: values.policyKind,
        systemPrompt: values.systemPrompt.trim(),
        allowedScores: values.allowedScores
          .split(',')
          .map((part) => Number(part.trim())),
        reasonCodes: values.reasonCodes
          .split(',')
          .map((part) => part.trim())
          .filter((code) => code.length > 0),
      })
      form.setFieldsValue({
        policyKind: updated.policyKind,
        systemPrompt: updated.systemPrompt,
        allowedScores: updated.allowedScores.join(', '),
        reasonCodes: updated.reasonCodes.join(', '),
      })
      message.success('Grading profile updated!')
    } catch (err) {
      message.error(`Could not save grading profile: ${getErrorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Grading Profile" className="mb-4" loading={loading}>
      <p className="mb-4 text-gray-600">
        One shared profile per course: the grading instructions, shared rubric,
        allowed scores, reason codes, and grading policy used for every
        embeddable question. Each question can add its own rubric, instructions,
        and sentence bounds.
      </p>
      <Form form={form} onFinish={handleSave} layout="vertical">
        <Form.Item
          name="policyKind"
          label="Grading Policy"
          rules={[{ required: true, message: 'Grading policy is required.' }]}
        >
          <Select
            onChange={handlePolicyChange}
            options={[
              { value: 'generic', label: 'Generic' },
              { value: 'indg-reflection', label: 'INDG reflection' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="systemPrompt"
          label="Course-wide Grading Instructions and Rubric"
          rules={[
            {
              required: true,
              whitespace: true,
              message: 'System prompt is required.',
            },
          ]}
        >
          <Input.TextArea rows={4} maxLength={15000} />
        </Form.Item>
        <Form.Item
          name="allowedScores"
          label={
            <div className="flex items-center gap-1">
              <span>Allowed Scores (comma-separated)</span>
              {isIndg && (
                <Tooltip title="INDG reflection requires the fixed INDG scores.">
                  <InfoCircleOutlined className="text-gray-400" />
                </Tooltip>
              )}
            </div>
          }
          rules={[
            {
              required: true,
              message: 'Allowed scores are required.',
            },
            {
              validator(_, value: unknown) {
                if (typeof value !== 'string' || value.trim().length === 0) {
                  return Promise.reject(
                    new Error('Allowed scores are required.'),
                  )
                }
                const parts = value.split(',').map((part) => part.trim())
                const scores = parts.map(Number)
                if (
                  parts.some(
                    (part) =>
                      part.length === 0 || !Number.isFinite(Number(part)),
                  ) ||
                  scores.some((score) => score < 0 || score > 100) ||
                  new Set(scores).size !== scores.length
                ) {
                  return Promise.reject(
                    new Error(
                      'Allowed scores must be unique comma-separated numbers from 0 to 100.',
                    ),
                  )
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input placeholder="e.g. 0, 0.5, 1, 1.5, 2" disabled={isIndg} />
        </Form.Item>
        <Form.Item
          name="reasonCodes"
          label={
            <div className="flex items-center gap-1">
              <span>Reason Codes (comma-separated)</span>
              {isIndg && (
                <Tooltip title="INDG reflection requires the fixed INDG reason codes.">
                  <InfoCircleOutlined className="text-gray-400" />
                </Tooltip>
              )}
            </div>
          }
          rules={[
            {
              required: true,
              whitespace: true,
              message: 'Reason codes are required.',
            },
            {
              validator(_, value: unknown) {
                if (typeof value !== 'string') return Promise.resolve()
                const codes = value
                  .split(',')
                  .map((code) => code.trim())
                  .filter(Boolean)
                if (new Set(codes).size !== codes.length) {
                  return Promise.reject(
                    new Error('Reason codes must be unique.'),
                  )
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input
            placeholder="e.g. meets_requirements, too_short"
            disabled={isIndg}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save Grading Profile
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
