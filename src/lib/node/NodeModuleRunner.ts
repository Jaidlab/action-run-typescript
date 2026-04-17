import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'

import {spawn} from 'node:child_process'
import path from 'node:path'

import {ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS,
  ACTION_RUN_TYPESCRIPT_INTERNAL_CODE,
  ACTION_RUN_TYPESCRIPT_INTERNAL_MODE} from './internalEnvironment.ts'

export interface NodeModuleRunnerOptions {
  readonly actionPath: string
  readonly bindings: ActionRuntimeBindings
  readonly code: string
  readonly environment: Record<string, string | undefined>
  readonly workspace: string
}

const createSpawnEnvironment = (environment: Record<string, string | undefined>) => Object.fromEntries(Object.entries(environment)
  .filter(([, value]) => value !== undefined)) as Record<string, string>

export class NodeModuleRunner {
  readonly options: NodeModuleRunnerOptions

  constructor(options: NodeModuleRunnerOptions) {
    this.options = options
  }

  async run() {
    const child = spawn(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '--experimental-vm-modules',
      path.resolve(this.options.actionPath),
    ], {
      cwd: this.options.workspace,
      env: createSpawnEnvironment({
        ...this.options.environment,
        [ACTION_RUN_TYPESCRIPT_INTERNAL_MODE]: '1',
        [ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS]: JSON.stringify(this.options.bindings),
        [ACTION_RUN_TYPESCRIPT_INTERNAL_CODE]: this.options.code,
      }),
      stdio: 'inherit',
    })
    const {exitCode, signal} = await new Promise<{exitCode: number | null
      signal: string | null}>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (closedExitCode, closedSignal) => {
        resolve({
          exitCode: closedExitCode,
          signal: closedSignal,
        })
      })
    })
    if (signal) {
      throw new Error(`Inline TypeScript exited due to signal ${signal}.`)
    }
    const normalizedExitCode = exitCode ?? 0
    if (normalizedExitCode !== 0) {
      throw new Error(`Inline TypeScript exited with code ${normalizedExitCode}.`)
    }
  }
}
