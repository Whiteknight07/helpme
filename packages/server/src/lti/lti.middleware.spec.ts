import { ltiMessages } from './lti.middleware';

describe('LTI dynamic registration', () => {
  it('adds the instructor-only Canvas editor button without changing Resource Links', () => {
    const messages = ltiMessages('https://helpme.test/api/v1/lti');

    expect(messages[0]).toMatchObject({
      type: 'LtiResourceLinkRequest',
      placements: [
        'link_selection',
        'course_home_sub_navigation',
        'course_navigation',
        'module_menu',
      ],
    });
    expect(messages[1]).toEqual({
      type: 'LtiDeepLinkingRequest',
      target_link_uri: 'https://helpme.test/api/v1/lti',
      label: 'HelpMe',
      placements: ['editor_button'],
      roles: [
        'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
        'http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant',
      ],
      preferred_presentation: 'iframe',
      iframe: { width: 800, height: 600 },
      'https://canvas.instructure.com/lti/visibility': 'admins',
    });
  });
});
