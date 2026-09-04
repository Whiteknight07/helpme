'use client'

import { ReactElement, useEffect, useState } from 'react'
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
import { DEFAULT_RUBRIC, EmbeddableQuestion } from '@koh/common'
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
  name?: string | null
  questionText: string
  criteriaText: string
  instructions?: string | null
  minSentences?: number
  maxSentences?: number
  availabilityDates?: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
}

export default function EmbeddableQuestionForm({
  courseId,
  open,
  setOpen,
  editingQuestion,
  onSaveCallback,
}: EmbeddableQuestionFormProps): ReactElement {
  const [form] = Form.useForm<FormValues>()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!editingQuestion) form.resetFields()

    form.setFieldsValue(
      editingQuestion
        ? {
            name: editingQuestion.name ?? undefined,
            questionText: editingQuestion.questionText,
            criteriaText: editingQuestion.criteriaText,
            instructions: editingQuestion.instructions ?? undefined,
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
          }
        : { criteriaText: DEFAULT_RUBRIC, minSentences: 3, maxSentences: 5 },
    )
  }, [open, editingQuestion, form])

  const handleSave = async (values: FormValues) => {
    if (isLoading) return
    setIsLoading(true)

    try {
      const [availableFrom, availableUntil] = values.availabilityDates ?? []
      const payload = {
        name: values.name?.trim() || null,
        questionText: values.questionText.trim(),
        criteriaText: values.criteriaText.trim(),
        instructions: values.instructions?.trim() || null,
        minSentences: values.minSentences ?? 3,
        maxSentences: values.maxSentences ?? 5,
        availableFrom: availableFrom?.toDate() ?? null,
        availableUntil: availableUntil?.toDate() ?? null,
      }

      await (editingQuestion
        ? API.lti.embeddableQuestion.update(
            courseId,
            editingQuestion.id,
            payload,
          )
        : API.lti.embeddableQuestion.create(courseId, payload))
      message.success(
        `Successfully ${editingQuestion ? 'updated' : 'created'} embeddable question!`,
      )

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
          <Input
            maxLength={255}
            placeholder="e.g. Reflection 1 - Indigenous Perspectives"
          />
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
            {
              required: true,
              whitespace: true,
              message: 'Question text is required.',
            },
          ]}
        >
          <Input.TextArea
            rows={3}
            maxLength={15000}
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
              <span>Grading Rubric</span>
              <Tooltip title="This is the rubric the AI grades against and it can be edited.">
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            </div>
          }
          rules={[
            {
              required: true,
              whitespace: true,
              message: 'Criteria text is required.',
            },
          ]}
        >
          <Input.TextArea
            rows={6}
            maxLength={15000}
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
            maxLength={15000}
            placeholder="e.g. Offer encouragement and point out positive aspects before suggesting improvements."
          />
        </Form.Item>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="minSentences"
            label="Min Sentences"
            rules={[{ required: true, message: 'Min sentences is required.' }]}
          >
            <InputNumber min={1} max={100} className="w-full" />
          </Form.Item>

          <Form.Item
            name="maxSentences"
            label="Max Sentences"
            dependencies={['minSentences']}
            rules={[
              { required: true, message: 'Max sentences is required.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const min = getFieldValue('minSentences')
                  if (value != null && min != null && value < min) {
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
