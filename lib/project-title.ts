// The capstone project's title before anyone names it (what "Record submission" saved before students named their
// projects). Never printed on a project certificate: approving needs a real title. Shared by server and screens.
export const PROJECT_PLACEHOLDER = 'Capstone project'

/** The project's real title, or null while it is unnamed. */
export const namedProject = (title: string | null | undefined) => (title?.trim() && title.trim().toLowerCase() !== PROJECT_PLACEHOLDER.toLowerCase() ? title.trim() : null)
