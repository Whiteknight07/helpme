'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { API } from '@/app/api'
import { Button, Card, Image } from 'antd'
import CenteredSpinner from '@/app/components/CenteredSpinner'
import { isProd } from '@koh/common'

export default function EmbeddableQuestionLayout({
  children,
}: {
  children: ReactNode
}) {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    API.profile.getUser().then(
      () => setIsAuthorized(true),
      () => setIsAuthorized(false),
    )
  }, [])

  if (isAuthorized === null) {
    return <CenteredSpinner tip="Checking authentication state..." />
  }

  return (
    <>
      <style>{`
        html, body, #html {
          height: auto !important;
          min-height: 0 !important;
          background: transparent !important;
        }
        body {
          display: block !important;
          flex-grow: 0 !important;
        }
      `}</style>
      {!isAuthorized ? (
        <div className="flex min-h-32 flex-col items-center justify-center px-3 py-2">
          <Card title="Authentication Required!">
            <p className="text-zinc-600">
              You cannot access this resource at this time. Try launching the
              HelpMe LTI tool - a link to launch the tool should be visible in
              your Canvas course’s navigation bar.
            </p>
            <p className="mt-2 text-zinc-600">
              Alternatively, launch HelpMe in a new tab via the button below and
              log in:
            </p>
            <Button
              className="mt-3"
              type="default"
              target="_blank"
              icon={
                <span className="flex items-center justify-center">
                  <Image
                    src="/helpme_logo_small.png"
                    width={16}
                    height={16}
                    alt="LTI"
                    preview={false}
                  />
                </span>
              }
              href={`${process.env.NEXT_PUBLIC_HOST_PROTOCOL}://${process.env.NEXT_PUBLIC_HOSTNAME}${isProd() ? '' : `:${process.env.NEXT_PUBLIC_DEV_PORT}`}/login`}
            >
              Launch HelpMe
            </Button>
          </Card>
        </div>
      ) : (
        children
      )}
    </>
  )
}
