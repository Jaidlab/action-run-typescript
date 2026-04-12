import type {ActionRuntimeEnvironment} from './lib/ActionRuntime.ts'

import {ActionRuntime} from './lib/ActionRuntime.ts'

const runAction = async (environment = Bun.env as ActionRuntimeEnvironment) => {
  const runtime = new ActionRuntime(environment)
  await runtime.run()
}

export default runAction

if (import.meta.main) {
  await runAction()
}
