import path from 'node:path'

import {deprecatedContextEnvironmentNames} from './environment.ts'
import {internalEnvironmentNames} from './node/internalEnvironment.ts'
import {NodeModuleRunner} from './node/NodeModuleRunner.ts'
import {toForwardSlashPath} from './toForwardSlashPath.ts'

export interface ActionRuntimeEnvironment extends Record<string, string | undefined> {
  readonly ACTION_RUN_TYPESCRIPT_ACTION_PATH?: string
  readonly ACTION_RUN_TYPESCRIPT_CODE?: string
  readonly ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN?: string
  readonly ACTION_RUN_TYPESCRIPT_GLOBALS?: string
  readonly GITHUB_TOKEN?: string
  readonly GITHUB_WORKSPACE?: string
  readonly INPUT_CODE?: string
  readonly 'INPUT_GITHUB-TOKEN'?: string
  readonly INPUT_GLOBALS?: string
}

type MutableActionRuntimeEnvironment = Record<string, string | undefined>

export class ActionRuntime {
  readonly environment: ActionRuntimeEnvironment

  readonly workspace: string

  constructor(environment: ActionRuntimeEnvironment) {
    this.environment = environment
    this.workspace = toForwardSlashPath(path.resolve(environment.GITHUB_WORKSPACE || process.cwd()))
  }

  getActionPath() {
    const actionPath = this.environment.ACTION_RUN_TYPESCRIPT_ACTION_PATH
    if (!actionPath) {
      throw new Error('Missing internal action entry path.')
    }
    return path.resolve(actionPath)
  }

  getExecutionEnvironment() {
    const executionEnvironment: MutableActionRuntimeEnvironment = {
      ...(process.env as MutableActionRuntimeEnvironment),
      ...this.environment,
    }
    for (const name of [
      'ACTION_RUN_TYPESCRIPT_ACTION_PATH',
      ...deprecatedContextEnvironmentNames,
      ...internalEnvironmentNames,
    ] as const) {
      delete executionEnvironment[name]
    }
    return executionEnvironment
  }

  async run() {
    const runner = new NodeModuleRunner({
      actionPath: this.getActionPath(),
      environment: this.getExecutionEnvironment(),
      workspace: this.workspace,
    })
    await runner.run()
  }
}
