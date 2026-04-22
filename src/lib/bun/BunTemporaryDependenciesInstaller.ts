import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {createSpawnEnvironment} from '../createSpawnEnvironment.ts'
import {splitShellStyleArguments} from '../splitShellStyleArguments.ts'

export interface PreparedTemporaryDependencies {
  cleanup: () => void
  readonly nodeModulesFolder: string
}

export interface BunTemporaryDependenciesInstallerOptions {
  readonly environment: Record<string, string | undefined>
  readonly rawDependencies: string
  readonly runnerTemp?: string
}

export class BunTemporaryDependenciesInstaller {
  readonly options: BunTemporaryDependenciesInstallerOptions

  constructor(options: BunTemporaryDependenciesInstallerOptions) {
    this.options = options
  }

  getCommandArguments() {
    let argumentsList: Array<string>
    try {
      argumentsList = splitShellStyleArguments(this.options.rawDependencies)
    } catch (error) {
      throw new Error('Failed to parse action input "dependencies".', {cause: error})
    }
    if (!argumentsList.length) {
      throw new TypeError('Action input "dependencies" must contain at least one dependency or bun add argument.')
    }
    return argumentsList
  }

  prepare(): PreparedTemporaryDependencies {
    const tempRoot = path.resolve(this.options.runnerTemp || os.tmpdir())
    mkdirSync(tempRoot, {recursive: true})
    const folder = mkdtempSync(path.join(tempRoot, 'action-run-typescript-dependencies-'))
    const cleanup = () => {
      rmSync(folder, {
        force: true,
        recursive: true,
      })
    }
    try {
      const result = spawnSync(process.execPath, ['add', ...this.getCommandArguments()], {
        cwd: folder,
        env: createSpawnEnvironment(this.options.environment),
        stdio: 'inherit',
      })
      if (result.error) {
        throw result.error
      }
      if (result.signal) {
        throw new Error(`Temporary dependency installation exited due to signal ${result.signal}.`)
      }
      const exitCode = result.status ?? 0
      if (exitCode !== 0) {
        throw new Error(`Temporary dependency installation exited with code ${exitCode}.`)
      }
      return {
        cleanup,
        nodeModulesFolder: path.join(folder, 'node_modules'),
      }
    } catch (error) {
      cleanup()
      throw error
    }
  }
}
