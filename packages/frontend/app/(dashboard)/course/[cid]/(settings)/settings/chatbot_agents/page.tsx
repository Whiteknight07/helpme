'use client'

import { API } from '@/app/api'
import { useUserInfo } from '@/app/contexts/userContext'
import { getErrorMessage, getRoleInCourse } from '@/app/utils/generalUtils'
import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Space,
  Table,
  TableProps,
  Tag,
} from 'antd'
import {
  CreateChatbotAgentParams,
  Role,
  StaffChatbotAgentCourse,
  UpdateChatbotAgentParams,
} from '@koh/common'
import { ReactElement, use, useCallback, useEffect, useState } from 'react'

type ChatbotAgentsProps = {
  params: Promise<{ cid: string }>
}

type AgentFormValues = {
  agentName: string
  agentDescription?: string
  agentOrder?: number
  initialPrompt?: string
}

export default function ChatbotAgents(props: ChatbotAgentsProps): ReactElement {
  const params = use(props.params)
  const courseId = Number(params.cid)
  const { userInfo } = useUserInfo()
  const role = getRoleInCourse(userInfo, courseId)
  const isProfessor = role === Role.PROFESSOR
  const courseName =
    userInfo.courses.find((e) => e.course.id === courseId)?.course.name ?? ''

  const [agents, setAgents] = useState<StaffChatbotAgentCourse[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updatingAgentCourseId, setUpdatingAgentCourseId] = useState<
    number | null
  >(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAgent, setEditingAgent] =
    useState<StaffChatbotAgentCourse | null>(null)
  const [form] = Form.useForm<AgentFormValues>()

  const fetchAgents = useCallback(async () => {
    setDataLoading(true)
    try {
      const response = await API.chatbot.staffOnly.getAgentsForStaff(courseId)
      setAgents(response)
    } catch (e) {
      message.error('Failed to load chatbot agents: ' + getErrorMessage(e))
    } finally {
      setDataLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const openCreateModal = () => {
    setEditingAgent(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEditModal = (agent: StaffChatbotAgentCourse) => {
    setEditingAgent(agent)
    form.setFieldsValue({
      agentName: agent.agentName,
      agentDescription: agent.description,
      agentOrder: agent.order,
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingAgent(null)
    form.resetFields()
  }

  const handleSubmit = async (values: AgentFormValues) => {
    setSubmitting(true)

    try {
      if (editingAgent) {
        await API.chatbot.staffOnly.updateAgent(
          courseId,
          editingAgent.courseId,
          {
            agentName: values.agentName,
            agentDescription: values.agentDescription ?? '',
            agentOrder: values.agentOrder,
          } satisfies UpdateChatbotAgentParams,
        )
        message.success('Chatbot agent updated.')
      } else {
        await API.chatbot.staffOnly.createAgent(courseId, {
          agentName: values.agentName,
          agentDescription: values.agentDescription || undefined,
          agentOrder: values.agentOrder,
          initialPrompt: values.initialPrompt || undefined,
        } satisfies CreateChatbotAgentParams)
        message.success('Chatbot agent added.')
      }
      closeModal()
      await fetchAgents()
    } catch (e) {
      message.error('Failed to save chatbot agent: ' + getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const updateAgentEnabled = async (
    agent: StaffChatbotAgentCourse,
    enabled: boolean,
  ) => {
    setUpdatingAgentCourseId(agent.courseId)
    try {
      await API.chatbot.staffOnly.updateAgent(courseId, agent.courseId, {
        enabled,
      })
      message.success(`Chatbot agent ${enabled ? 'enabled' : 'disabled'}.`)
      fetchAgents()
    } catch (e) {
      message.error(
        `Failed to ${enabled ? 'enable' : 'disable'} chatbot agent: ` +
          getErrorMessage(e),
      )
    } finally {
      setUpdatingAgentCourseId(null)
    }
  }

  const columns: TableProps<StaffChatbotAgentCourse>['columns'] = [
    {
      title: 'Agent name',
      dataIndex: 'agentName',
      key: 'agentName',
      sorter: (a, b) => a.agentName.localeCompare(b.agentName),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description?: string) => description || 'No description',
    },
    {
      title: 'Order',
      dataIndex: 'order',
      key: 'order',
      sorter: (a, b) => (a.order ?? 0) - (b.order ?? 0),
      render: (order?: number) => order ?? '-',
    },
    {
      title: 'Status',
      dataIndex: 'enabled',
      key: 'enabled',
      filters: [
        { text: 'Enabled', value: true },
        { text: 'Disabled', value: false },
      ],
      onFilter: (value, record) => record.enabled === value,
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'green' : 'red'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </Tag>
      ),
    },
    ...(isProfessor
      ? [
          {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, record: StaffChatbotAgentCourse) => (
              <Space>
                <Button onClick={() => openEditModal(record)}>Edit</Button>
                <Popconfirm
                  title={`${record.enabled ? 'Disable' : 'Enable'} this agent?`}
                  description={
                    record.enabled
                      ? 'Students will no longer see this agent. Its documents and history are kept and it can be re-enabled.'
                      : 'Students will be able to select this agent in the course chatbot.'
                  }
                  okText={record.enabled ? 'Disable' : 'Enable'}
                  okButtonProps={{ danger: record.enabled }}
                  onConfirm={() => updateAgentEnabled(record, !record.enabled)}
                >
                  <Button
                    danger={record.enabled}
                    loading={updatingAgentCourseId === record.courseId}
                  >
                    {record.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="m-auto my-5">
      <title>{`HelpMe | Editing ${courseName} Chatbot Agents`}</title>
      <div className="flex w-full items-center justify-between">
        <div>
          <h3 className="m-0 p-0 text-4xl font-bold text-gray-900">
            Manage Chatbot Agents
          </h3>
          <p className="text-[16px] font-medium text-gray-600">
            Students pick an agent inside this course&apos;s chatbot. Each agent
            has its own prompt, documents, and settings.
          </p>
        </div>
        {isProfessor && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreateModal}
          >
            Add Agent
          </Button>
        )}
      </div>
      <hr className="my-5 w-full"></hr>
      <Table<StaffChatbotAgentCourse>
        columns={columns}
        dataSource={agents}
        rowKey="courseId"
        loading={dataLoading}
        className="w-full"
        bordered
        locale={{
          emptyText: (
            <Empty description="No chatbot agents yet. Add a first agent to give students a course-specific chatbot persona." />
          ),
        }}
      />
      <Modal
        title={editingAgent ? 'Edit Chatbot Agent' : 'Add Chatbot Agent'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText={editingAgent ? 'Save' : 'Add Agent'}
      >
        <Form<AgentFormValues>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            label="Agent name"
            name="agentName"
            rules={[{ required: true, message: 'Please enter an agent name.' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="agentDescription">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="Order" name="agentOrder">
            <InputNumber className="w-full" />
          </Form.Item>
          {!editingAgent && (
            <Form.Item
              label="Initial prompt"
              name="initialPrompt"
              help="The prompt can be edited later on the Chatbot Settings page."
            >
              <Input.TextArea rows={5} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
