// Ready-made course lists a new institute can start from (Set Up → Courses): departments with their usual courses,
// durations and fees. A starting point only: everything is editable afterwards under Courses.

export type CatalogueCourse = { title: string; weeks: number; fee: number /* rupees, before GST */; skills?: string }
export type Catalogue = { key: string; label: string; about: string; departments: { name: string; courses: CatalogueCourse[] }[] }

export const CATALOGUES: Catalogue[] = [
  { key: 'computer', label: 'Computer centre', about: 'Basic computing, office and accounts, programming and the web.', departments: [
    { name: 'Basic & Accounting', courses: [
      { title: 'Basic Computer Course', weeks: 12, fee: 6000, skills: 'Windows, MS Word, MS Excel, PowerPoint, Internet' },
      { title: 'Tally Prime with GST', weeks: 12, fee: 9000, skills: 'Tally Prime, GST, TDS, Payroll' },
      { title: 'Advanced Excel', weeks: 6, fee: 5000, skills: 'Formulas, Pivot tables, Charts, VLOOKUP, Macros' },
    ] },
    { name: 'Programming', courses: [
      { title: 'C and C++', weeks: 12, fee: 8000, skills: 'C, C++, Data structures' },
      { title: 'Python', weeks: 12, fee: 10000, skills: 'Python, OOP, File handling, Libraries' },
      { title: 'Java', weeks: 16, fee: 12000, skills: 'Core Java, OOP, Collections, JDBC' },
    ] },
    { name: 'Web Development', courses: [
      { title: 'Web Design', weeks: 12, fee: 12000, skills: 'HTML, CSS, JavaScript, Bootstrap' },
      { title: 'Full Stack Development', weeks: 24, fee: 35000, skills: 'React, Node.js, Express.js, MongoDB' },
    ] },
  ] },
  { key: 'cad', label: 'CAD / design centre', about: 'Drafting and modelling for civil and mechanical.', departments: [
    { name: 'Civil CAD', courses: [
      { title: 'AutoCAD 2D & 3D', weeks: 8, fee: 9000, skills: 'AutoCAD' },
      { title: 'Revit Architecture', weeks: 10, fee: 14000, skills: 'Revit' },
      { title: 'BIM with Revit', weeks: 16, fee: 25000, skills: 'AutoCAD, Revit, Navisworks' },
    ] },
    { name: 'Mechanical CAD', courses: [
      { title: 'SolidWorks', weeks: 10, fee: 14000, skills: 'SolidWorks' },
      { title: 'CATIA', weeks: 12, fee: 16000, skills: 'CATIA' },
      { title: 'Creo', weeks: 10, fee: 14000, skills: 'Creo Parametric' },
    ] },
  ] },
  { key: 'digital-marketing', label: 'Digital marketing', about: 'Search, social, ads and content.', departments: [
    { name: 'Digital Marketing', courses: [
      { title: 'Digital Marketing Foundation', weeks: 8, fee: 12000, skills: 'SEO, Social media, Google Ads, Analytics' },
      { title: 'Advanced Digital Marketing', weeks: 16, fee: 25000, skills: 'SEO, SEM, Meta Ads, Email marketing, Analytics' },
      { title: 'Social Media Marketing', weeks: 6, fee: 8000, skills: 'Instagram, Facebook, LinkedIn, Content' },
    ] },
  ] },
  { key: 'spoken-english', label: 'Spoken English & personality', about: 'Speaking, grammar and interviews.', departments: [
    { name: 'English', courses: [
      { title: 'Spoken English (Basic)', weeks: 12, fee: 6000, skills: 'Speaking, Grammar, Vocabulary' },
      { title: 'Spoken English (Advanced)', weeks: 12, fee: 8000, skills: 'Fluency, Presentations, Group discussion' },
      { title: 'Personality Development', weeks: 6, fee: 5000, skills: 'Confidence, Interviews, Etiquette' },
    ] },
  ] },
  { key: 'ielts', label: 'IELTS / PTE coaching', about: 'Tests for study and work abroad.', departments: [
    { name: 'Language Tests', courses: [
      { title: 'IELTS Academic', weeks: 8, fee: 12000, skills: 'Listening, Reading, Writing, Speaking' },
      { title: 'IELTS General', weeks: 6, fee: 10000, skills: 'Listening, Reading, Writing, Speaking' },
      { title: 'PTE Academic', weeks: 6, fee: 11000, skills: 'Speaking, Writing, Reading, Listening' },
    ] },
  ] },
  { key: 'school-tuition', label: 'School tuition', about: 'Classes 6 to 12, by subject group.', departments: [
    { name: 'Classes 6–8', courses: [{ title: 'Classes 6–8: Maths & Science', weeks: 40, fee: 18000 }] },
    { name: 'Classes 9–10', courses: [{ title: 'Class 9–10: Maths', weeks: 40, fee: 20000 }, { title: 'Class 9–10: Science', weeks: 40, fee: 20000 }] },
    { name: 'Classes 11–12', courses: [{ title: 'Class 11–12: Physics, Chemistry, Maths', weeks: 40, fee: 45000 }, { title: 'Class 11–12: Commerce', weeks: 40, fee: 35000 }] },
  ] },
]

export const catalogue = (key: string) => CATALOGUES.find((c) => c.key === key)
