'use client'

import React, { useEffect, useState } from 'react'
import {
  Alert,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Tooltip,
  message,
} from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { EmbeddableQuestion, UpsertEmbeddableQuestionParams } from '@koh/common'
import dayjs from 'dayjs'
import { API } from '@/app/api'
import { getErrorMessage } from '@/app/utils/generalUtils'

interface EmbeddableQuestionFormProps {
  courseId: number
  open: boolean
  setOpen: (open: boolean) => void
  editingQuestion?: EmbeddableQuestion
  onSaveCallback: () => void
}

interface FormValues {
  name?: string
  questionText: string
  criteriaText: string
  instructions?: string
  minSentences?: number
  maxSentences?: number
  availabilityDates?: [dayjs.Dayjs | null, dayjs.Dayjs | null]
}

export default function EmbeddableQuestionForm({
  courseId,
  open,
  setOpen,
  editingQuestion,
  onSaveCallback,
}: EmbeddableQuestionFormProps): React.ReactElement {
  const [form] = Form.useForm<FormValues>()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      if (editingQuestion) {
        form.setFieldsValue({
          name: editingQuestion.name,
          questionText: editingQuestion.questionText,
          criteriaText: editingQuestion.criteriaText,
          instructions: editingQuestion.instructions,
          minSentences: editingQuestion.minSentences ?? 3,
          maxSentences: editingQuestion.maxSentences ?? 5,
          availabilityDates: [
            editingQuestion.availableFrom
              ? dayjs(editingQuestion.availableFrom)
              : null,
            editingQuestion.availableUntil
              ? dayjs(editingQuestion.availableUntil)
              : null,
          ],
        })
      } else {
        form.resetFields()
        form.setFieldsValue({
          minSentences: 3,
          maxSentences: 5,
        })
      }
    }
  }, [open, editingQuestion, form])

  const handleSave = async (values: FormValues) => {
    if (isLoading) return
    setIsLoading(true)

    try {
      const payload: UpsertEmbeddableQuestionParams = {
        name: values.name?.trim() || undefined,
        questionText: values.questionText.trim(),
        criteriaText: values.criteriaText.trim(),
        instructions: values.instructions?.trim() || undefined,
        minSentences: values.minSentences ?? 3,
        maxSentences: values.maxSentences ?? 5,
        availableFrom: values.availabilityDates?.[0]
          ? values.availabilityDates[0].toDate()
          : undefined,
        availableUntil: values.availabilityDates?.[1]
          ? values.availabilityDates[1].toDate()
          : undefined,
      }

      if (
        payload.minSentences !== undefined &&
        payload.maxSentences !== undefined &&
        payload.minSentences > payload.maxSentences
      ) {
        message.error('Minimum sentences cannot be greater than maximum.')
        setIsLoading(false)
        return
      }

      if (editingQuestion) {
        await API.lti.embeddableQuestion.update(
          courseId,
          editingQuestion.id,
          payload,
        )
        message.success('Successfully updated embeddable question!')
      } else {
        await API.lti.embeddableQuestion.create(courseId, payload)
        message.success('Successfully created embeddable question!')
      }

      setOpen(false)
      onSaveCallback()
    } catch (err: unknown) {
      message.error(`Could not save question: ${getErrorMessage(err)}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={
        editingQuestion
          ? 'Edit Embeddable Question'
          : 'Create Embeddable Question'
      }
      open={open}
      okButtonProps={{ htmlType: 'submit', loading: isLoading }}
      onCancel={() => setOpen(false)}
      okText={editingQuestion ? 'Save' : 'Create'}
      destroyOnClose
      modalRender={(dom) => (
        <Form
          form={form}
          onFinish={handleSave}
          layout="vertical"
          clearOnDestroy
        >
          {dom}
        </Form>
      )}
    >
      <div className="flex flex-col gap-1">
        <Form.Item
          name="name"
          label={
            <div className="flex items-center gap-1">
              <span>Question Name / Title</span>
              <Tooltip title="An optional internal name for this question configuration (e.g. Reflection 1).">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
        >
          <Input placeholder="e.g. Reflection 1 - Indigenous Perspectives" />
        </Form.Item>

        <Form.Item
          name="questionText"
          label={
            <div className="flex items-center gap-1">
              <span>Question Text</span>
              <Tooltip title="The prompt or question that students see and respond to in the iframe.">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
          rules={[
            { required: true, message: 'Question text is required.' },
            {
              validator: (_, value) => {
                if (value && !value.trim()) {
                  return Promise.reject(
                    new Error(
                      'Question text cannot be only whitespace characters.',
                    ),
                  )
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input.TextArea
            rows={3}
            placeholder="e.g. Reflect on how the reading connects to Indigenous governance principles."
          />
        </Form.Item>

        <Alert
          className="mb-3"
          type="info"
          showIcon
          message="AI Feedback Prompt Configuration"
          description="The AI model uses the Student Answer along with the Question Text, Criteria, and Instructions configured here to generate structured feedback."
        />

        <Form.Item
          name="criteriaText"
          label={
            <div className="flex items-center gap-1">
              <span>Rubric / Criteria</span>
              <Tooltip title="The marking criteria or rubric used by the AI model to evaluate the student draft.">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
          rules={[
            { required: true, message: 'Criteria text is required.' },
            {
              validator: (_, value) => {
                if (value && !value.trim()) {
                  return Promise.reject(
                    new Error(
                      'Criteria text cannot be only whitespace characters.',
                    ),
                  )
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input.TextArea
            rows={3}
            placeholder="e.g. The response should identify at least two core principles and provide specific examples."
          />
        </Form.Item>

        <Form.Item
          name="instructions"
          label={
            <div className="flex items-center gap-1">
              <span>Additional Feedback Instructions</span>
              <Tooltip title="Optional specific instructions passed into the prompt (e.g. emphasis on constructive suggestions).">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
        >
          <Input.TextArea
            rows={2}
            placeholder="e.g. Offer encouragement and point out positive aspects before suggesting improvements."
          />
        </Form.Item>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="minSentences"
            label="Min Sentences"
            rules={[
              { required: true, message: 'Min sentences is required.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const max = getFieldValue('maxSentences')
                  if (value && max && value > max) {
                    return Promise.reject(
                      new Error('Min sentences cannot exceed max sentences.'),
                    )
                  }
                  return Promise.resolve()
                },
              }),
            ]}
          >
            <InputNumber min={1} max={100} className="w-full" />
          </Form.Item>

          <Form.Item
            name="maxSentences"
            label="Max Sentences"
            rules={[
              { required: true, message: 'Max sentences is required.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const min = getFieldValue('minSentences')
                  if (value && min && value < min) {
                    return Promise.reject(
                      new Error(
                        'Max sentences cannot be less than min sentences.',
                      ),
                    )
                  }
                  return Promise.resolve()
                },
              }),
            ]}
          >
            <InputNumber min={1} max={100} className="w-full" />
          </Form.Item>
        </div>

        <Form.Item
          name="availabilityDates"
          label={
            <div className="flex items-center gap-1">
              <span>Availability Window (Optional)</span>
              <Tooltip title="Leave empty for always available. If set, feedback is only available during this window.">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
        >
          <DatePicker.RangePicker
            showTime
            className="w-full"
            format="YYYY-MM-DD HH:mm"
          />
        </Form.Item>
      </div>
    </Modal>
  )
}
