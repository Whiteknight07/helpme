'use client'

import { ReactElement, use, useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { EmbeddableQuestion } from '@koh/common'
import { API } from '@/app/api'
import { getErrorMessage } from '@/app/utils/generalUtils'
import EmbeddableQuestionForm from './EmbeddableQuestionForm'

interface EmbeddableQuestionsPageProps {
  params: Promise<{ cid: string }>
}

export default function EmbeddableQuestionsPage(
  props: EmbeddableQuestionsPageProps,
): ReactElement {
  const params = use(props.params)
  const courseId = Number(params.cid)

  const [questions, setQuestions] = useState<EmbeddableQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<
    EmbeddableQuestion | undefined
  >(undefined)
  const [previewQuestion, setPreviewQuestion] = useState<
    EmbeddableQuestion | undefined
  >(undefined)

  const fetchQuestions = useCallback(async () => {
    try {
      setQuestions(await API.lti.embeddableQuestion.getAll(courseId))
    } catch (err: unknown) {
      message.error(`Failed to load questions: ${getErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    fetchQuestions()
  }, [fetchQuestions])

  const openCreateModal = () => {
    setEditingQuestion(undefined)
    setModalOpen(true)
  }

  const openEditModal = (q: EmbeddableQuestion) => {
    setEditingQuestion(q)
    setModalOpen(true)
  }

  const handleDelete = async (q: EmbeddableQuestion) => {
    try {
      await API.lti.embeddableQuestion.delete(courseId, q.id)
      message.success('Successfully deleted question!')
      fetchQuestions()
    } catch (err: unknown) {
      message.error(`Failed to delete question: ${getErrorMessage(err)}`)
    }
  }

  const getIFrameUrl = (q: EmbeddableQuestion) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/lti/embeddable/${courseId}/question/${q.id}`
  }

  const getIFrameHtml = (q: EmbeddableQuestion) => {
    return `<iframe src="${getIFrameUrl(q)}" width="100%" height="280" style="border:0;display:block;" allow="clipboard-write"></iframe>`
  }

  const copyEmbedHtml = async (q: EmbeddableQuestion) => {
    try {
      const embedCode = getIFrameHtml(q)
      await navigator.clipboard.writeText(embedCode)
      message.success('Canvas embed HTML copied to clipboard!')
    } catch (err: unknown) {
      message.error(`Failed to copy embed HTML: ${getErrorMessage(err)}`)
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text: string, record: EmbeddableQuestion) => (
        <span className="font-medium text-gray-800">
          {text || `Question ${record.id}`}
        </span>
      ),
    },
    {
      title: 'Question Text',
      dataIndex: 'questionText',
      key: 'questionText',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Rubric / Criteria',
      dataIndex: 'criteriaText',
      key: 'criteriaText',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Instructions',
      dataIndex: 'instructions',
      key: 'instructions',
      ellipsis: true,
      render: (text?: string) =>
        text ? (
          <Tooltip title={text}>
            <span>{text}</span>
          </Tooltip>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      title: 'Sentences',
      key: 'sentences',
      width: 100,
      render: (_: unknown, record: EmbeddableQuestion) => (
        <span>
          {record.minSentences ?? 3} - {record.maxSentences ?? 5}
        </span>
      ),
    },
    {
      title: 'Canvas Embed',
      key: 'embed',
      width: 180,
      render: (_: unknown, record: EmbeddableQuestion) => (
        <Space size="small">
          <Button
            icon={<CopyOutlined />}
            size="small"
            onClick={() => copyEmbedHtml(record)}
          >
            Copy HTML
          </Button>
          <Button
            icon={<EyeOutlined />}
            size="small"
            onClick={() => setPreviewQuestion(record)}
          >
            Preview
          </Button>
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: EmbeddableQuestion) => (
        <Space size="small">
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEditModal(record)}
          />
          <Popconfirm
            title="Delete this question?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="Embeddable Questions"
      classNames={{
        body: 'p-1 md:p-6',
      }}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
        >
          Create Question
        </Button>
      }
    >
      <p className="mb-4 text-gray-600">
        Configure questions that can be embedded into Canvas quizzes or pages as
        an iframe (`/lti/embeddable/:courseId/question/:questionId`).
        Authenticated students can type an answer draft to receive immediate
        AI-powered feedback before final submission.
      </p>

      <Table
        dataSource={questions}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{
          emptyText:
            'No embeddable questions created for this course yet. Click "Create Question" to get started.',
        }}
      />

      <EmbeddableQuestionForm
        courseId={courseId}
        open={modalOpen}
        setOpen={setModalOpen}
        editingQuestion={editingQuestion}
        onSaveCallback={fetchQuestions}
      />

      {previewQuestion && (
        <Modal
          title={`Preview: ${previewQuestion.name || `Question ${previewQuestion.id}`}`}
          open={!!previewQuestion}
          onCancel={() => setPreviewQuestion(undefined)}
          footer={[
            <Button
              key="copy"
              icon={<CopyOutlined />}
              onClick={() => copyEmbedHtml(previewQuestion)}
            >
              Copy Embed Code
            </Button>,
            <Button
              key="close"
              type="primary"
              onClick={() => setPreviewQuestion(undefined)}
            >
              Close
            </Button>,
          ]}
          width={700}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Canvas Iframe Embed HTML
              </p>
              <Typography.Paragraph
                copyable
                className="rounded bg-gray-50 p-2 font-mono text-xs text-gray-800"
              >
                {getIFrameHtml(previewQuestion)}
              </Typography.Paragraph>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Live Iframe Preview
              </p>
              <div className="overflow-hidden rounded border border-gray-200">
                <iframe
                  src={getIFrameUrl(previewQuestion)}
                  title={previewQuestion.name || 'Question Preview'}
                  width="100%"
                  height="280"
                  className="border-0"
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  )
}
