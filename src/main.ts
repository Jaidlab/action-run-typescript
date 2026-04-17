import type {ActionRuntimeEnvironment} from './lib/ActionRuntime.ts'

import path from 'node:path'

import {ActionRuntime} from './lib/ActionRuntime.ts'

const actionEntryPath = import.meta.filename
const isMainModule = () => {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }
  return path.resolve(entryPath) === actionEntryPath
}
const runAction = async (environment = process.env as ActionRuntimeEnvironment) => {
  const runtime = new ActionRuntime(environment)
  await runtime.run()
}

export default runAction

if (isMainModule()) {
  await runAction()
}
