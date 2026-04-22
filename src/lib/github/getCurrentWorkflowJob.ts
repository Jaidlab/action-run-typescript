export interface GitHubContext {
  readonly api_url?: string
  readonly job?: string
  readonly repository?: string
  readonly run_attempt?: number | string
  readonly run_id?: number | string
  readonly token?: string
}

export interface WorkflowJobStep {
  readonly completed_at?: string | null
  readonly conclusion?: string | null
  readonly name?: string | null
  readonly number?: number | null
  readonly started_at?: string | null
  readonly status?: string | null
}

export interface WorkflowJob {
  readonly completed_at?: string | null
  readonly conclusion?: string | null
  readonly html_url?: string | null
  readonly id?: number
  readonly name?: string | null
  readonly runner_name?: string | null
  readonly started_at?: string | null
  readonly status?: string | null
  readonly steps?: ReadonlyArray<WorkflowJobStep>
  readonly url?: string | null
}

export type FetchImplementation = (input: Request | URL | string, init?: RequestInit) => Promise<Response>

export interface GetCurrentWorkflowJobOptions {
  readonly fetch?: FetchImplementation
  readonly github: GitHubContext
  readonly runnerName?: string
  readonly token?: string
}

interface ListWorkflowJobsResponse {
  readonly jobs?: ReadonlyArray<WorkflowJob>
}
const listWorkflowJobs = async ({fetch: fetchImplementation = fetch, github, token}: GetCurrentWorkflowJobOptions) => {
  const repository = github.repository
  const runId = github.run_id
  if (!repository || !runId || !token) {
    return
  }
  const [owner, repo] = repository.split('/', 2)
  if (!owner || !repo) {
    return
  }
  const jobs: Array<WorkflowJob> = []
  for (let page = 1; page <= 10; page++) {
    const baseUrl = github.api_url || 'https://api.github.com'
    const endpointPath = github.run_attempt ? `/repos/${owner}/${repo}/actions/runs/${runId}/attempts/${github.run_attempt}/jobs` : `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
    const url = new URL(endpointPath, baseUrl)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', '100')
    const response = await fetchImplementation(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Jaidlab/action-run-typescript',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) {
      return
    }
    const payload = await response.json() as ListWorkflowJobsResponse
    const pageJobs = [...payload.jobs || []]
    jobs.push(...pageJobs)
    if (pageJobs.length < 100) {
      break
    }
  }
  return jobs
}
const resolveCurrentWorkflowJob = (jobs: ReadonlyArray<WorkflowJob>, {github, runnerName}: GetCurrentWorkflowJobOptions) => {
  if (jobs.length === 1) {
    return jobs[0]
  }
  const jobName = github.job
  if (jobName) {
    const nameMatches = jobs.filter(job => job.name === jobName)
    if (nameMatches.length === 1) {
      return nameMatches[0]
    }
    if (nameMatches.length > 1 && runnerName) {
      const namedRunnerMatches = nameMatches.filter(job => job.runner_name === runnerName)
      if (namedRunnerMatches.length === 1) {
        return namedRunnerMatches[0]
      }
      const namedRunningRunnerMatches = namedRunnerMatches.filter(job => job.status === 'in_progress')
      if (namedRunningRunnerMatches.length === 1) {
        return namedRunningRunnerMatches[0]
      }
    }
  }
  if (runnerName) {
    const runningRunnerMatches = jobs.filter(job => job.runner_name === runnerName && job.status === 'in_progress')
    if (runningRunnerMatches.length === 1) {
      return runningRunnerMatches[0]
    }
  }
  const runningJobs = jobs.filter(job => job.status === 'in_progress')
  if (runningJobs.length === 1) {
    return runningJobs[0]
  }
  if (runnerName) {
    const runnerMatches = jobs.filter(job => job.runner_name === runnerName)
    if (runnerMatches.length === 1) {
      return runnerMatches[0]
    }
  }
}

export const getCurrentWorkflowJob = async (options: GetCurrentWorkflowJobOptions) => {
  const jobs = await listWorkflowJobs(options)
  if (!jobs?.length) {
    return
  }
  return resolveCurrentWorkflowJob(jobs, options)
}
