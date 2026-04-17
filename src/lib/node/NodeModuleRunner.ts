import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'
import type {VmRunnerPayload} from './VmRunnerPayload.ts'

import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export interface NodeModuleRunnerOptions {
  readonly bindings: ActionRuntimeBindings
  readonly bundle: string
  readonly environment: Record<string, string | undefined>
  readonly globals: Record<string, unknown>
  readonly vmRunnerPath: string
  readonly workspace: string
}

const createSpawnEnvironment = (environment: Record<string, string | undefined>) => Object.fromEntries(Object.entries(environment)
  .filter(([, value]) => value !== undefined)) as Record<string, string>
const waitForChildProcess = (child: ReturnType<typeof spawn>) => new Promise<{exitCode: number | null
  signal: string | null}>((resolve, reject) => {
  child.once('error', reject)
  child.once('close', (exitCode, signal) => {
    resolve({
      exitCode,
      signal,
    })
  })
})

export class NodeModuleRunner {
  readonly options: NodeModuleRunnerOptions

  constructor(options: NodeModuleRunnerOptions) {
    this.options = options
  }

  getPayload(): VmRunnerPayload {
    return {
      bindings: this.options.bindings,
      globals: this.options.globals,
      identifier: pathToFileURL(path.join(this.options.workspace, '__action_run_typescript_bundle__.mjs')).href,
    }
  }

  getTempRoot() {
    return this.options.environment.RUNNER_TEMP || os.tmpdir()
  }

  async run() {
    mkdirSync(this.getTempRoot(), {recursive: true})
    const temporaryFolder = mkdtempSync(path.join(this.getTempRoot(), 'action-run-typescript-'))
    const bundleFile = path.join(temporaryFolder, 'bundle.mjs')
    const payloadFile = path.join(temporaryFolder, 'payload.json')
    writeFileSync(bundleFile, this.options.bundle, 'utf8')
    writeFileSync(payloadFile, JSON.stringify(this.getPayload()), 'utf8')
    try {
      const child = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning',
        '--experimental-vm-modules',
        path.resolve(this.options.vmRunnerPath),
        path.resolve(payloadFile),
        path.resolve(bundleFile),
      ], {
        cwd: this.options.workspace,
        env: createSpawnEnvironment(this.options.environment),
        stdio: 'inherit',
      })
      const {exitCode, signal} = await waitForChildProcess(child)
      if (signal) {
        throw new Error(`Inline TypeScript exited due to signal ${signal}.`)
      }
      const normalizedExitCode = exitCode ?? 0
      if (normalizedExitCode !== 0) {
        throw new Error(`Inline TypeScript exited with code ${normalizedExitCode}.`)
      }
    } finally {
      rmSync(temporaryFolder, {
        force: true,
        recursive: true,
      })
    }
  }
}
