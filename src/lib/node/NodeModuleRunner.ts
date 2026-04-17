import {spawn} from 'node:child_process'

export interface NodeModuleRunnerOptions {
  readonly bundleFile: string
  readonly environment: Record<string, string | undefined>
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

  async run() {
    const child = spawn(process.execPath, [this.options.bundleFile], {
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
  }
}
