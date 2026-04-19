const unresolvedExpressionPattern = /^\s*\$\{\{[\s\S]*\}\}\s*$/
const deprecatedContextEnvironmentNames = [
  'ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT',
  'ACTION_RUN_TYPESCRIPT_JOB_CONTEXT',
  'ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT',
  'ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT',
  'ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT',
  'ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT',
  'INPUT_GITHUB_CONTEXT',
  'INPUT_JOB_CONTEXT',
  'INPUT_MATRIX_CONTEXT',
  'INPUT_RUNNER_CONTEXT',
  'INPUT_STEPS',
  'INPUT_STRATEGY_CONTEXT',
] as const
const legacyActionRuntimeInputEnvironmentNames = [
  'ACTION_RUN_TYPESCRIPT_CODE',
  'ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN',
  'ACTION_RUN_TYPESCRIPT_GLOBALS',
  'ACTION_RUN_TYPESCRIPT_INJECT_GOODIES',
] as const
const actionInputEnvironmentNames = ['INPUT_CODE', 'INPUT_GITHUB-TOKEN', 'INPUT_GLOBALS', 'INPUT_INJECTGOODIES'] as const

export const scrubbedEnvironmentNames = [
  ...deprecatedContextEnvironmentNames,
  ...legacyActionRuntimeInputEnvironmentNames,
  ...actionInputEnvironmentNames,
] as const

export const normalizeEnvironmentValue = (value: string | undefined) => {
  if (value === undefined || value === '') {
    return
  }
  if (unresolvedExpressionPattern.test(value)) {
    return
  }
  return value
}

export const getEnvironmentValue = (environment: Record<string, string | undefined>, ...names: ReadonlyArray<string>) => {
  for (const name of names) {
    const value = normalizeEnvironmentValue(environment[name])
    if (value !== undefined) {
      return value
    }
  }
}
