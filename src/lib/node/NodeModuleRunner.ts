import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'

import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {createVmRunnerSource} from './createVmRunnerSource.ts'

export interface NodeModuleRunnerOptions {
  readonly bindings: ActionRuntimeBindings
  readonly bundle: string
  readonly environment: Record<string, string | undefined>
  readonly globals: Record<string, unknown>
  readonly workspace: string
}

const createSpawnEnvironment = (environment: Record<string, string | undefined>) => Object.fromEntries(Object.entries(environment)
  .filter(([, value]) => value !== undefined)) as Record<string, string>

export class NodeModuleRunner {
  readonly options: NodeModuleRunnerOptions

  constructor(options: NodeModuleRunnerOptions) {
    this.options = options
  }

  getTempRoot() {
    return this.options.environment.RUNNER_TEMP || os.tmpdir()
  }

  getVirtualBundleIdentifier() {
    return pathToFileURL(path.join(this.options.workspace, '__action_run_typescript_bundle__.mjs')).href
  }

  async run() {
    mkdirSync(this.getTempRoot(), {recursive: true})
    const temporaryFolder = mkdtempSync(path.join(this.getTempRoot(), 'action-run-typescript-'))
    const bundleFile = path.join(temporaryFolder, 'bundle.mjs')
    const payloadFile = path.join(temporaryFolder, 'payload.json')
    const runnerFile = path.join(temporaryFolder, 'runner.mjs')
    writeFileSync(bundleFile, this.options.bundle, 'utf8')
    writeFileSync(payloadFile, JSON.stringify({
      bindings: this.options.bindings,
      globals: this.options.globals,
      identifier: this.getVirtualBundleIdentifier(),
    }), 'utf8')
    writeFileSync(runnerFile, createVmRunnerSource(), 'utf8')
    try {
      const child = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning',
        '--experimental-vm-modules',
        path.resolve(runnerFile),
        path.resolve(payloadFile),
        path.resolve(bundleFile),
      ], {
        cwd: this.options.workspace,
        env: createSpawnEnvironment(this.options.environment),
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
    } finally {
      rmSync(temporaryFolder, {
        force: true,
        recursive: true,
      })
    }
  }
}
