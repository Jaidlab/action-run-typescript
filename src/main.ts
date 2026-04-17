import type {ActionRuntimeEnvironment, ActionRuntimeOptions} from './lib/ActionRuntime.ts'

import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {ActionRuntime} from './lib/ActionRuntime.ts'

const actionEntryPath = import.meta.filename
const createActionRuntimeOptions = (): ActionRuntimeOptions => ({
  vmRunnerPath: fileURLToPath(new URL(`./vm-runner${path.extname(import.meta.filename)}`, import.meta.url)),
})
const isMainModule = () => {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }
  return path.resolve(entryPath) === actionEntryPath
}
const runAction = async (environment = process.env as ActionRuntimeEnvironment) => {
  const runtime = new ActionRuntime(environment, createActionRuntimeOptions())
  await runtime.run()
}

export default runAction

if (isMainModule()) {
  await runAction()
}
