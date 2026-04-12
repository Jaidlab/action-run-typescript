import type {WorkflowJob, WorkflowJobStep} from './getCurrentWorkflowJob.ts'

export interface WorkflowStepsFallback {
  readonly $byName: Record<string, Array<WorkflowJobStep>>
  readonly $byNumber: Record<string, WorkflowJobStep>
  readonly $bySlug: Record<string, Array<WorkflowJobStep>>
  readonly $job: {
    readonly conclusion: string | null
    readonly id: number | null
    readonly name: string | null
    readonly status: string | null
    readonly url: string | null
  }
  readonly $list: ReadonlyArray<WorkflowJobStep>
  readonly $source: 'github-job-api'
}

type GroupedStepRecord = Partial<Record<string, Array<WorkflowJobStep>>>

const pushGroupedStep = (record: GroupedStepRecord, key: string, step: WorkflowJobStep) => {
  const list = record[key]
  if (list) {
    list.push(step)
    return
  }
  record[key] = [step]
}
const startsWithDigit = (value: string) => {
  const firstCharacter = value.slice(0, 1)
  return firstCharacter >= '0' && firstCharacter <= '9'
}
const toSlug = (value: string, fallback = 'step') => {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^0-9a-z]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  if (!slug) {
    return fallback
  }
  if (startsWithDigit(slug)) {
    return `step_${slug}`
  }
  return slug
}

export const toWorkflowStepsFallback = (workflowJob: WorkflowJob): WorkflowStepsFallback => {
  const stepsSource = workflowJob.steps ?? []
  const steps = [...stepsSource]
  const byName: GroupedStepRecord = {}
  const byNumber: Record<string, WorkflowJobStep> = {}
  const bySlug: GroupedStepRecord = {}
  for (const step of steps) {
    if (step.number !== undefined && step.number !== null) {
      byNumber[String(step.number)] = step
    }
    if (step.name) {
      pushGroupedStep(byName, step.name, step)
      const slug = toSlug(step.name, step.number === undefined || step.number === null ? 'step' : `step_${step.number}`)
      pushGroupedStep(bySlug, slug, step)
      continue
    }
    const fallbackSlug = toSlug(step.number === undefined || step.number === null ? 'step' : String(step.number))
    pushGroupedStep(bySlug, fallbackSlug, step)
  }
  return {
    $source: 'github-job-api',
    $job: {
      conclusion: workflowJob.conclusion ?? null,
      id: workflowJob.id ?? null,
      name: workflowJob.name ?? null,
      status: workflowJob.status ?? null,
      url: workflowJob.html_url ?? workflowJob.url ?? null,
    },
    $list: steps,
    $byNumber: byNumber,
    $byName: byName as Record<string, Array<WorkflowJobStep>>,
    $bySlug: bySlug as Record<string, Array<WorkflowJobStep>>,
  }
}
