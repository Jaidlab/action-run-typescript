import type {GitHubContext} from './getCurrentWorkflowJob.ts'

export interface ActionRuntimeGitHubContext extends GitHubContext {
  readonly action?: string
  readonly actor?: string
  readonly apiUrl?: string
  readonly event?: unknown
  readonly event_name?: string
  readonly eventName?: string
  readonly graphql_url?: string
  readonly graphqlUrl?: string
  readonly issue?: {
    readonly number?: number
    readonly owner?: string
    readonly repo?: string
  }
  readonly payload?: unknown
  readonly ref?: string
  readonly repo?: {
    readonly owner?: string
    readonly repo?: string
  }
  readonly run_number?: number
  readonly runAttempt?: number
  readonly runId?: number
  readonly runNumber?: number
  readonly server_url?: string
  readonly serverUrl?: string
  readonly sha?: string
  readonly workflow?: string
}

export interface ToolkitGitHubContext {
  readonly action?: string
  readonly actor?: string
  readonly apiUrl?: string
  readonly eventName?: string
  readonly graphqlUrl?: string
  readonly issue?: {
    readonly number?: number
    readonly owner?: string
    readonly repo?: string
  }
  readonly job?: string
  readonly payload?: unknown
  readonly ref?: string
  readonly repo?: {
    readonly owner?: string
    readonly repo?: string
  }
  readonly runAttempt?: number
  readonly runId?: number
  readonly runNumber?: number
  readonly serverUrl?: string
  readonly sha?: string
  readonly workflow?: string
}
const normalizeNumber = (value: number | undefined) => {
  if (Number.isFinite(value)) {
    return value
  }
}

export const toActionRuntimeGitHubContext = (context: ToolkitGitHubContext, token?: string): ActionRuntimeGitHubContext => {
  let repo: ToolkitGitHubContext['repo']
  try {
    repo = context.repo
  } catch {
  }
  let issue: ToolkitGitHubContext['issue']
  try {
    issue = context.issue
  } catch {
  }
  const repository = repo?.owner && repo.repo ? `${repo.owner}/${repo.repo}` : undefined
  const runAttempt = normalizeNumber(context.runAttempt)
  const runId = normalizeNumber(context.runId)
  const runNumber = normalizeNumber(context.runNumber)
  return {
    action: context.action,
    actor: context.actor,
    api_url: context.apiUrl,
    apiUrl: context.apiUrl,
    event: context.payload,
    event_name: context.eventName,
    eventName: context.eventName,
    graphql_url: context.graphqlUrl,
    graphqlUrl: context.graphqlUrl,
    issue,
    job: context.job,
    payload: context.payload,
    ref: context.ref,
    repo,
    repository,
    run_attempt: runAttempt,
    run_number: runNumber,
    run_id: runId,
    runAttempt,
    runId,
    runNumber,
    server_url: context.serverUrl,
    serverUrl: context.serverUrl,
    sha: context.sha,
    token,
    workflow: context.workflow,
  }
}
