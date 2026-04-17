export const actionInputNames = ['code', 'github-token', 'globals'] as const

const unresolvedExpressionPattern = /^\s*\$\{\{[\s\S]*\}\}\s*$/

export const deprecatedContextEnvironmentNames = [
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

export const legacyActionRuntimeInputEnvironmentNames = [
  'ACTION_RUN_TYPESCRIPT_CODE',
  'ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN',
  'ACTION_RUN_TYPESCRIPT_GLOBALS',
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

export const toInputEnvironmentName = (name: string) => `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`

export const actionInputEnvironmentNames = actionInputNames.map(toInputEnvironmentName)

export const scrubbedEnvironmentNames = [
  ...deprecatedContextEnvironmentNames,
  ...legacyActionRuntimeInputEnvironmentNames,
  ...actionInputEnvironmentNames,
] as const
