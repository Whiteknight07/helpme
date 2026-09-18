import StandardPageContainer from '@/app/components/standardPageContainer'
import { Button, Result } from 'antd'
import Link from 'next/link'
import { ExpandOutlined } from '@ant-design/icons'
import { usePathname } from 'next/navigation'

const ThirdPartyCookiesWarning: React.FC = () => {
  const pathname = usePathname()
  const isQuestion = pathname.startsWith('/lti/embeddable/')
  const courseId = Number(pathname.match(/^\/lti\/(?:embeddable\/)?(\d+)/)?.[1])
  const qparams = '?launch_from_lti=true'
  const launchUrl = courseId ? `/course/${courseId}${qparams}` : `/${qparams}`

  return (
    <StandardPageContainer>
      <Result
        status="error"
        title="Third-Party Cookies Disabled"
        extra={[
          <div className="mt-12 flex flex-col gap-2 text-center" key="error">
            <p>
              {isQuestion ? 'This question' : 'HelpMe'} needs third-party
              cookies to keep you signed in inside your learning platform.
            </p>
            <p>
              Allow third-party cookies for HelpMe in your browser settings,
              then refresh this page.
            </p>
            <div>
              <Button onClick={() => window.location.reload()}>
                Refresh page
              </Button>
            </div>
            <p>
              You can also open HelpMe in a separate window to sign in. You may
              still need to allow cookies and reopen the question in your
              learning platform.
            </p>
            <div>
              <Link
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
              >
                <Button type="primary" icon={<ExpandOutlined />}>
                  Open HelpMe in a new window
                </Button>
              </Link>
            </div>
          </div>,
        ]}
      />
    </StandardPageContainer>
  )
}

export default ThirdPartyCookiesWarning
