// What is printed on every student membership card (the same for every institute). The institute's own details (logo,
// address, phone, website, social page) come from its brand, and the campuses from its branches.
export const CARD = {
  tagline: ['LEARN', 'SKILL', 'SUCCEED'],
  promises: ['Quality Education', 'Skill Development', 'Expert Guidance', 'Job Placement'],
  terms: [
    'This card is valid only for the duration of the enrolled course or training program.',
    'Students can access support and guidance from all branches of the institute.',
    'Membership benefits are applicable only to the specific course in which the student is enrolled.',
    'The membership card is non-transferable and valid only for the registered student.',
    'The institute reserves the right to update or modify policies and offers when required.',
  ],
  /**
   * The "Scan to verify" code opens this path of the app. For now the sign-in page; point it at the student's own
   * dashboard page once that exists.
   */
  verifyPath: '/login',
} as const
