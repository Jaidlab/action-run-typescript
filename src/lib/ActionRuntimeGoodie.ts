import {evaluateJavaScriptExpression} from './evaluateJavaScriptExpression.ts'

export const actionRuntimeGoodieNames = ['core', 'github', 'job', 'matrix', 'runner', 'steps', 'strategy', 'workflowJob'] as const

export type ActionRuntimeGoodieName = typeof actionRuntimeGoodieNames[number]

export const actionRuntimeGoodieNamesText = actionRuntimeGoodieNames.map(name => JSON.stringify(name)).join(', ')

const actionRuntimeGoodieNamesSet = new Set<string>(actionRuntimeGoodieNames)
const parseActionRuntimeGoodieValues = (rawGoodies: string) => {
  const normalizedGoodies = rawGoodies.trim()
  if (/^[\s\w,]+$/.test(normalizedGoodies)) {
    return normalizedGoodies.split(/[\s,]+/).filter(Boolean)
  }
  let parsed: unknown
  try {
    parsed = evaluateJavaScriptExpression(normalizedGoodies)
  } catch (error) {
    throw new Error('Failed to parse action input "goodies".', {cause: error})
  }
  if (typeof parsed === 'string') {
    return [parsed]
  }
  if (Array.isArray(parsed)) {
    const values: Array<unknown> = parsed
    return values
  }
  throw new TypeError('Action input "goodies" must evaluate to a string or an array of strings.')
}

export const createAllActionRuntimeGoodies = () => new Set<ActionRuntimeGoodieName>(actionRuntimeGoodieNames)

export const parseActionRuntimeGoodies = (rawGoodies: string) => {
  const goodies = new Set<ActionRuntimeGoodieName>
  for (const value of parseActionRuntimeGoodieValues(rawGoodies)) {
    if (typeof value !== 'string') {
      throw new TypeError('Action input "goodies" must only contain strings.')
    }
    if (!actionRuntimeGoodieNamesSet.has(value)) {
      throw new TypeError(`Action input "goodies" contains unsupported value ${JSON.stringify(value)}. Supported values: ${actionRuntimeGoodieNamesText}.`)
    }
    goodies.add(value as ActionRuntimeGoodieName)
  }
  return goodies
}
