export interface SessionSearchDocument {
  active: boolean
  archived: boolean
  branches: string[]
  project: string[]
  status: string
  tags: string[]
  text: string[]
}

export interface ParsedSessionQuery {
  branchTerms: string[]
  filterActive: boolean
  filterArchived: boolean
  projectTerms: string[]
  statusTerms: string[]
  tagTerms: string[]
  text: string
}

export function parseSessionQuery(query: string): ParsedSessionQuery {
  const result: ParsedSessionQuery = {
    branchTerms: [],
    filterActive: false,
    filterArchived: false,
    projectTerms: [],
    statusTerms: [],
    tagTerms: [],
    text: '',
  }
  const textParts: string[] = []

  for (const part of query.trim().split(/\s+/).filter(Boolean)) {
    const lower = part.toLowerCase()
    if (lower === 'is:active') result.filterActive = true
    else if (lower === 'is:archived') result.filterArchived = true
    else if (lower.startsWith('project:')) result.projectTerms.push(lower.slice(8))
    else if (lower.startsWith('branch:')) result.branchTerms.push(lower.slice(7))
    else if (lower.startsWith('status:')) result.statusTerms.push(lower.slice(7))
    else if (lower.startsWith('tag:') || lower.startsWith('#')) {
      const tag = lower.startsWith('tag:') ? lower.slice(4) : lower.slice(1)
      if (tag) result.tagTerms.push(tag)
    } else textParts.push(lower)
  }
  result.text = textParts.join(' ')
  return result
}

export function sessionMatchesParsedQuery(
  document: SessionSearchDocument,
  query: ParsedSessionQuery
): boolean {
  const includesAny = (values: string[], terms: string[]): boolean =>
    terms.length === 0 ||
    terms.some((term) => values.some((value) => value.toLowerCase().includes(term)))

  if (query.filterActive && !document.active) return false
  if (query.filterArchived && !document.archived) return false
  if (!includesAny(document.project, query.projectTerms)) return false
  if (!includesAny(document.branches, query.branchTerms)) return false
  if (!includesAny([document.status], query.statusTerms)) return false
  if (!includesAny(document.tags, query.tagTerms)) return false
  if (
    query.text &&
    ![...document.project, ...document.text].some((value) =>
      value.toLowerCase().includes(query.text)
    )
  )
    return false
  return true
}

export function sessionQueryHasQualifiers(query: ParsedSessionQuery): boolean {
  return (
    query.filterActive ||
    query.filterArchived ||
    query.projectTerms.length > 0 ||
    query.branchTerms.length > 0 ||
    query.statusTerms.length > 0 ||
    query.tagTerms.length > 0
  )
}
