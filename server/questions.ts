import type { Question } from '../shared/types.ts'

const YES_NO = ['Yes', 'No']
const DECLINE = 'Decline to answer'

// The one-time setup questions. Answers are saved and reused on every
// application, so each one should be something application forms ask often.
export const QUESTIONS: Question[] = [
  // ── About you
  { key: 'first_name', section: 'About you', label: 'First name', type: 'text', required: true },
  { key: 'last_name', section: 'About you', label: 'Last name', type: 'text', required: true },
  {
    key: 'preferred_name',
    section: 'About you',
    label: 'Preferred name',
    help: 'Only if it differs from your first name.',
    type: 'text',
    required: false,
  },
  { key: 'email', section: 'About you', label: 'Email', help: 'Confirmations and verification codes go here.', type: 'email', required: true },
  { key: 'phone', section: 'About you', label: 'Phone', type: 'tel', required: true },
  {
    key: 'address_line1',
    section: 'About you',
    label: 'Street address',
    help: 'Workday forms (24 of your jobs) require a full address.',
    type: 'text',
    required: false,
  },
  { key: 'city', section: 'About you', label: 'City', type: 'text', required: true },
  { key: 'state', section: 'About you', label: 'State', type: 'text', placeholder: 'FL', required: true },
  { key: 'zip', section: 'About you', label: 'ZIP code', type: 'text', required: true },
  { key: 'country', section: 'About you', label: 'Country', type: 'text', required: true },

  // ── Links
  { key: 'linkedin', section: 'Links', label: 'LinkedIn URL', type: 'url', required: true },
  { key: 'portfolio', section: 'Links', label: 'Portfolio or website', type: 'url', required: false },
  {
    key: 'github',
    section: 'Links',
    label: 'GitHub URL',
    help: 'Many engineering forms ask for it. Leave blank if you would rather not share one.',
    type: 'url',
    required: false,
  },

  // ── Education
  { key: 'school', section: 'Education', label: 'School', type: 'text', required: true },
  { key: 'degree', section: 'Education', label: 'Degree', type: 'text', placeholder: 'Bachelor of Science', required: true },
  { key: 'major', section: 'Education', label: 'Major', type: 'text', required: true },
  { key: 'graduation', section: 'Education', label: 'Graduation month and year', type: 'text', placeholder: 'December 2025', required: true },
  { key: 'gpa', section: 'Education', label: 'GPA', help: 'Only used when a form requires it.', type: 'text', required: false },

  // ── Work eligibility
  {
    key: 'work_authorized',
    section: 'Work eligibility',
    label: 'Are you legally authorized to work in the United States?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'sponsorship_now',
    section: 'Work eligibility',
    label: 'Do you need visa sponsorship now?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'sponsorship_future',
    section: 'Work eligibility',
    label: 'Will you need visa sponsorship in the future?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'citizenship_status',
    section: 'Work eligibility',
    label: 'What is your work authorization based on?',
    help: 'Some employers (defense, aerospace) must ask whether you are a "U.S. person". The app only uses this for that question.',
    type: 'select',
    options: ['U.S. citizen', 'Permanent resident (green card)', 'Other work authorization', 'Ask me each time'],
    required: true,
  },
  { key: 'over_18', section: 'Work eligibility', label: 'Are you 18 or older?', type: 'select', options: YES_NO, required: true },
  {
    key: 'security_clearance',
    section: 'Work eligibility',
    label: 'Active security clearance',
    type: 'select',
    options: ['None', 'Public Trust', 'Secret', 'Top Secret', 'Top Secret / SCI'],
    required: false,
  },

  // ── Availability and pay
  {
    key: 'earliest_start',
    section: 'Availability and pay',
    label: 'Earliest start date',
    help: 'A date, or a phrase such as "Immediately" or "Two weeks after an offer".',
    type: 'text',
    required: true,
  },
  {
    key: 'desired_salary',
    section: 'Availability and pay',
    label: 'Desired annual salary (USD)',
    help: 'Used only when a form insists on a number. If the posting lists a range, the app stays inside it.',
    type: 'number',
    placeholder: '85000',
    required: true,
  },
  {
    key: 'min_pay',
    section: 'Availability and pay',
    label: 'Lowest annual pay you would accept (USD)',
    help: 'Used for "Is this pay within your range?" questions; hourly pay is counted as 2,080 hours a year. Leave blank to have those wait for you.',
    type: 'number',
    placeholder: '45000',
    required: false,
  },
  {
    key: 'relocate',
    section: 'Availability and pay',
    label: 'Are you willing to relocate for a role?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'relocation_timing',
    section: 'Availability and pay',
    label: 'How soon could you relocate?',
    type: 'text',
    placeholder: 'Within 30 days of an offer',
    required: false,
  },
  {
    key: 'onsite_ok',
    section: 'Availability and pay',
    label: 'Are you open to working fully on-site?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'travel',
    section: 'Availability and pay',
    label: 'How much work travel are you open to?',
    type: 'select',
    options: ['None', 'Up to 10%', 'Up to 25%', 'Up to 50%', 'Any amount'],
    required: false,
  },

  // ── Current work
  { key: 'current_employer', section: 'Current work', label: 'Current employer', type: 'text', required: true },
  { key: 'current_title', section: 'Current work', label: 'Current job title', type: 'text', required: true },
  {
    key: 'current_employment_type',
    section: 'Current work',
    label: 'What kind of position is your current job?',
    type: 'select',
    options: ['Full-time employee', 'Part-time employee', 'Contract', 'Freelance / self-employed'],
    required: true,
  },
  {
    key: 'years_experience',
    section: 'Current work',
    label: 'Years of professional software experience',
    help: 'Forms often ask for a single number.',
    type: 'number',
    required: true,
  },
  {
    key: 'notice_period',
    section: 'Current work',
    label: 'Notice period at your current job',
    type: 'text',
    placeholder: 'Two weeks',
    required: false,
  },

  {
    key: 'languages',
    section: 'Current work',
    label: 'Languages you speak fluently',
    help: 'Used for questions like "Are you fluent in Spanish?". Leave blank to have those wait for you.',
    type: 'text',
    placeholder: 'English, Spanish',
    required: false,
  },

  // ── Common yes / no questions
  {
    key: 'how_heard',
    section: 'Common questions',
    label: 'How did you hear about this job? (default answer)',
    type: 'select',
    options: ['Company website', 'Job board', 'LinkedIn', 'Online search', 'Other'],
    required: true,
  },
  {
    key: 'worked_here_before',
    section: 'Common questions',
    label: 'Have you worked for any company on your list before?',
    help: 'If Yes, the app asks you on each application instead of answering.',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'non_compete',
    section: 'Common questions',
    label: 'Are you bound by a non-compete or similar agreement?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'background_check',
    section: 'Common questions',
    label: 'Will you consent to a background check if required?',
    type: 'select',
    options: YES_NO,
    required: true,
  },
  {
    key: 'sms_consent',
    section: 'Common questions',
    label: 'May employers text you about your application?',
    type: 'select',
    options: YES_NO,
    required: false,
  },

  // ── Voluntary self-identification
  {
    key: 'gender',
    section: 'Voluntary self-identification',
    label: 'Gender',
    type: 'select',
    options: [DECLINE, 'Male', 'Female', 'Non-binary'],
    required: false,
  },
  {
    key: 'hispanic_latino',
    section: 'Voluntary self-identification',
    label: 'Are you Hispanic or Latino?',
    type: 'select',
    options: [DECLINE, 'Yes', 'No'],
    required: false,
  },
  {
    key: 'race',
    section: 'Voluntary self-identification',
    label: 'Race',
    type: 'select',
    options: [
      DECLINE,
      'American Indian or Alaska Native',
      'Asian',
      'Black or African American',
      'Native Hawaiian or Other Pacific Islander',
      'White',
      'Two or more races',
    ],
    required: false,
  },
  {
    key: 'veteran_status',
    section: 'Voluntary self-identification',
    label: 'Veteran status',
    type: 'select',
    options: [DECLINE, 'I am not a protected veteran', 'I am a protected veteran'],
    required: false,
  },
  {
    key: 'disability_status',
    section: 'Voluntary self-identification',
    label: 'Disability status',
    type: 'select',
    options: [DECLINE, 'No, I do not have a disability', 'Yes, I have a disability'],
    required: false,
  },

  // ── Reusable written answers
  {
    key: 'about_me',
    section: 'Written answers',
    label: 'Tell us about yourself (2–3 sentences)',
    help: 'Optional. If blank, the app drafts one from your resume and shows it to you before use.',
    type: 'textarea',
    required: false,
  },
  {
    key: 'why_looking',
    section: 'Written answers',
    label: 'Why are you looking for a new role?',
    type: 'textarea',
    required: false,
  },
  {
    key: 'proud_project',
    section: 'Written answers',
    label: 'A project you are proud of',
    type: 'textarea',
    required: false,
  },
]

export const SECTION_NOTES: Record<string, string> = {
  'Voluntary self-identification':
    'Employers must offer these but you never have to answer. They default to "Decline to answer" and stay on this computer.',
  'Written answers':
    'All optional. Anything you write here is reused word for word; anything the app drafts always waits for your approval.',
}

/** Safe defaults applied on first run. Everything else starts blank or comes from the resume profile. */
export const DEFAULTS: Record<string, string> = {
  gender: DECLINE,
  hispanic_latino: DECLINE,
  race: DECLINE,
  veteran_status: DECLINE,
  disability_status: DECLINE,
  sms_consent: 'No',
  security_clearance: 'None',
}
