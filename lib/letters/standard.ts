// The standard internship letters (from scripts/INERN-SEL.MD and scripts/INTERSHIP-COM.MD), with every detail of the
// intern as a {{variable}}. Head office can change the wording in Documents → Letter Templates; "Reset to standard"
// brings these back.
//
// Writing a template (kept simple on purpose):
//   # Title            a heading            ## Section          a section heading
//   1. text            a numbered line      - text              a bullet
//   **bold**           bold text            an empty line       a new paragraph
//   {{name}}           the intern's name, and every other variable listed in VARIABLES

export type LetterKind = 'internship_offer' | 'internship_completion'

export const LETTER_TITLE: Record<LetterKind, string> = {
  internship_offer: 'Internship Selection Letter',
  internship_completion: 'Internship Completion Certificate',
}

export const STANDARD: Record<LetterKind, string> = {
  internship_offer: `# INTERNSHIP SELECTION CERTIFICATE

{{salutation}} {{name}}
{{address}}

**Subject: Offer of Internship as {{designation}}**

Dear {{name}},

We are pleased to offer you an internship opportunity with {{company_name}} for the position of {{designation}}, commencing from {{from_date}}, subject to the successful completion of the mandatory pre-internship training period.

At {{company_name}}, we believe in developing industry-ready professionals through practical exposure, continuous learning, and hands-on experience. As part of our assessment, we have identified certain areas where your existing skills require further development and refinement. Therefore, before the commencement of your paid internship, you will undergo structured training under the guidance of our domain experts.

## 1. Pre-Internship Training Period

Your training will commence on {{training_from}} and continue until {{training_to}}.

The terms and conditions of the training period are as follows:

- **Duration:** {{training_from}} to {{training_to}}.
- **Nature:** Unpaid training and skill-development period.
- **Mode:** Hybrid, combining online learning and offline training sessions as scheduled by the company.
- **Training Location:** You will be required to travel to our {{training_location}} office/location for offline training sessions as instructed by the company.
- **Training Guidance:** You will receive training from our experts in the relevant domains to strengthen your practical knowledge, technical competencies, communication, and professional skills.

During this period, you are expected to demonstrate a proactive learning attitude, discipline, regular attendance, and a willingness to implement feedback provided by your trainers.

Please note that the training period is separate from the paid internship and will not carry any stipend or salary.

## 2. Internship Details

Upon successful completion of the training period, your internship will commence under the following terms:

- **Designation:** {{designation}}
- **Joining Date:** {{from_date}}
- **Internship Duration:** {{Duration}}, from {{from_date}} to {{to_date}}.
- **Monthly Stipend:** {{stipend}} per month.
- **Working Location:** {{work_location}}.
- **Working Hours:** {{working_hours}}, as per company policy.
- **Work Mode:** {{work_mode}}

Any future relocation or change in your designated working location will be discussed mutually between you and the company before implementation.

## 3. Roles and Responsibilities

As a {{designation}}, you will be responsible for the following activities:

{{responsibilities}}

The above responsibilities are indicative and may be modified or expanded in accordance with the company's operational requirements.

## 4. Performance Evaluation

Your performance will be evaluated periodically based on your learning progress, practical implementation, quality of work, creativity, punctuality, communication skills, teaching effectiveness, teamwork, and achievement of assigned targets.

You are expected to demonstrate continuous improvement throughout the internship. The company may provide feedback and guidance to help you develop the professional competencies required for your role.

## 5. Attendance and Working Hours

You will be required to adhere to the company's working hours, currently scheduled from {{working_hours}}, and follow the applicable attendance, leave, reporting, and workplace policies.

Regular attendance during both the training and internship periods is essential. Any leave or absence must be communicated to and approved by the authorized reporting person in accordance with company policy.

## 6. Code of Conduct and Confidentiality

You must maintain the confidentiality of all company information, business strategies, marketing plans, student information, training materials, client details, and internal documents accessed during your association with {{company_name}}.

You are expected to comply with company policies, professional standards, and all reasonable instructions issued by your reporting manager or authorized personnel.

## 7. General Terms and Conditions

1. The pre-internship training period from {{training_from}} to {{training_to}} will be unpaid.
2. The paid internship will commence on {{from_date}}, following successful completion of the training period and confirmation by the company.
3. The monthly stipend of {{stipend}} will be applicable during the {{duration}} internship period, subject to applicable attendance and company policies.
4. Your primary working location will be {{work_location}}. Any proposed relocation will be discussed and mutually agreed upon.
5. The company reserves the right to review your performance and continuation in accordance with its policies and the terms of your internship.
6. Any extension, change in designation, or opportunity for employment beyond the internship period will be considered separately based on performance and business requirements and will be communicated by the company, where applicable.

We welcome you to {{company_name}} and look forward to supporting your professional development. We expect you to make the best use of this opportunity by demonstrating commitment, consistency, creativity, and a positive approach towards learning and work.

For any further clarification, please contact us at {{contact_phone}} or email {{contact_email}}.

Regards,

**{{company_name}}**
{{branch}}`,

  internship_completion: `# Internship Completion Certificate

Dear {{name}},

We are pleased to certify that you have successfully completed your internship as a {{designation}} at {{company}} from {{from_month}} to {{to_month}}.

During the internship tenure, {{he}} was involved in various technical and practical assignments related to {{domain}}. {{He}} demonstrated proficiency in tools and technologies such as {{skills}}.

{{project}}

{{He}} displayed excellent analytical skills, a strong willingness to learn, and maintained a professional attitude throughout the internship period.

We appreciate {{his}} efforts and wish {{him}} success in all future endeavors.

Regards,

**{{company}}**
{{branch}}`,
}

/** Every variable a template can use, with what it is and an example (shown in the editor and used for the preview). */
export const VARIABLES: { key: string; label: string; example: string }[] = [
  { key: 'name', label: 'Intern\'s full name', example: 'Chakshu Sharma' },
  { key: 'first_name', label: 'First name', example: 'Chakshu' },
  { key: 'salutation', label: 'Mr. / Ms.', example: 'Ms.' },
  { key: 'address', label: 'Address', example: 'A 87, New Amritsar,\nAmritsar, Punjab.' },
  { key: 'phone', label: 'Phone', example: '98765 43210' },
  { key: 'email', label: 'E-mail', example: 'chakshu@example.com' },
  { key: 'designation', label: 'Designation / role', example: 'Junior Digital Marketer' },
  { key: 'domain', label: 'Work area (what the work was about)', example: 'digital marketing campaigns, social media and SEO' },
  { key: 'training_from', label: 'Training starts', example: '12th November 2025' },
  { key: 'training_to', label: 'Training ends', example: '31st December 2025' },
  { key: 'training_location', label: 'Training location', example: 'Jalandhar' },
  { key: 'from_date', label: 'Internship starts', example: '1st January 2026' },
  { key: 'to_date', label: 'Internship ends', example: '30th June 2026' },
  { key: 'from_month', label: 'Start month (Month Year)', example: 'January 2026' },
  { key: 'to_month', label: 'End month (Month Year)', example: 'June 2026' },
  { key: 'duration', label: 'Duration, worked out (six months)', example: 'six months' },
  { key: 'Duration', label: 'Duration at the start of a sentence (Six months)', example: 'Six months' },
  { key: 'stipend', label: 'Monthly stipend', example: '₹10,000' },
  { key: 'work_location', label: 'Working location', example: 'Amritsar, Punjab' },
  { key: 'working_hours', label: 'Working hours', example: '9:00 AM to 6:00 PM' },
  { key: 'work_mode', label: 'Work mode', example: 'As assigned by the company, depending on business requirements and work responsibilities.' },
  { key: 'responsibilities', label: 'Roles and responsibilities (a list)', example: '**A. Digital Marketing and Online Promotion**\n1. Assist in planning, developing, and executing digital marketing campaigns.\n2. Manage and update social media platforms.' },
  { key: 'skills', label: 'Tools and skills (the intern’s, else the course’s)', example: 'Google Ads, Meta Business Suite, Canva and SEO tools' },
  { key: 'course', label: 'Course registered for', example: 'Digital Marketing' },
  { key: 'project', label: 'What the intern built or achieved', example: 'Chakshu planned and ran the institute\'s social media campaign for the summer batch, which doubled the enquiries from Instagram.' },
  { key: 'company', label: 'Company, full legal name', example: 'Acme Learning Pvt. Ltd.' },
  { key: 'company_name', label: 'Company name in a sentence (e.g. Acme)', example: 'Acme' },
  { key: 'branch', label: 'Branch', example: 'Acme Amritsar' },
  { key: 'contact_phone', label: 'Contact phone (HR)', example: '98xxx-xxxxx' },
  { key: 'contact_email', label: 'Contact e-mail (HR)', example: 'hr@yourinstitute.com' },
  { key: 'ref_no', label: 'Letter reference no.', example: 'TC/INT/2026/0007' },
  { key: 'date', label: 'Date of the letter', example: '10th October 2026' },
  { key: 'he', label: 'he / she', example: 'she' },
  { key: 'He', label: 'He / She (start of a sentence)', example: 'She' },
  { key: 'his', label: 'his / her', example: 'her' },
  { key: 'His', label: 'His / Her (start of a sentence)', example: 'Her' },
  { key: 'him', label: 'him / her', example: 'her' },
]
export const SAMPLE: Record<string, string> = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]))
