import type {ActionRuntimeEnvironment} from './lib/ActionRuntime.ts'

import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {ActionRuntime} from './lib/ActionRuntime.ts'
import {isInternalNodeActionEnvironment, runInternalNodeAction} from './lib/node/runInternalNodeAction.ts'

const actionEntryPath = import.meta.filename
const createActionRuntimeEnvironment = (environment: ActionRuntimeEnvironment): ActionRuntimeEnvironment => {
  if (environment.ACTION_RUN_TYPESCRIPT_ACTION_PATH) {
    return environment
  }
  return {
    ...environment,
    ACTION_RUN_TYPESCRIPT_ACTION_PATH: actionEntryPath,
  }
}
const isMainModule = () => {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }
  return path.resolve(entryPath) === actionEntryPath
}
const runAction = async (environment = process.env as ActionRuntimeEnvironment) => {
  if (isInternalNodeActionEnvironment(environment)) {
    await runInternalNodeAction(environment)
    return
  }
  const runtime = new ActionRuntime(createActionRuntimeEnvironment(environment))
  await runtime.run()
}

export default runAction

if (isMainModule()) {
  await runAction()
}
