// What is printed on every student membership card (the same for all branches).
export const CARD = {
  tagline: ['LEARN', 'SKILL', 'SUCCEED'],
  promises: ['Quality Education', 'Skill Development', 'Expert Guidance', 'Job Placement'],
  terms: [
    'This card is valid only for the duration of the enrolled course or training program.',
    'Students can access support and guidance from all company branches.',
    'Membership benefits are applicable only to the specific course in which the student is enrolled.',
    'Students upgrading from training to a full course can avail a special discount of 30% to 50%.',
    'The membership card is non-transferable and valid only for the registered student.',
    'The company reserves the right to update or modify policies and offers when required.',
  ],
  office: 'Corporate Office : Plot number F-547, 3rd floor, Industrial Area, 8A, Sector 75, Sahibzada Ajit Singh Nagar, Punjab 160055',
  phone: '+91 9888122206',
  website: 'www.techcadd.com',
  campuses: ['Jalandhar', 'Mohali', 'Phagwara', 'Hoshiarpur', 'Ludhiana', 'Amritsar'],
  /** The "Follow us" code. */
  followUrl: 'https://www.instagram.com/techcadd_india/',
  /**
   * The "Scan to verify" code opens this path of the app. For now the sign-in page; point it at the student's own
   * dashboard page once that exists.
   */
  verifyPath: '/login',
} as const
