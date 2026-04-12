import type {GitHubContext, WorkflowJob} from './github/getCurrentWorkflowJob.ts'

// eslint-disable-next-line typescript/no-restricted-imports
import {rm} from 'node:fs/promises'
import path from 'node:path'

import {createContextModuleContent} from './context/createContextModuleContent.ts'
import {createScriptModuleContent} from './context/createScriptModuleContent.ts'
import {getCurrentWorkflowJob} from './github/getCurrentWorkflowJob.ts'
import {toWorkflowStepsFallback} from './github/toWorkflowStepsFallback.ts'
import {parseJsonString} from './parseJsonString.ts'
import {toForwardSlashPath} from './toForwardSlashPath.ts'

export interface ActionRuntimeBindings {
  readonly github: unknown
  readonly job: unknown
  readonly matrix: unknown
  readonly runner: unknown
  readonly steps: unknown
  readonly strategy: unknown
  readonly workflowJob: unknown
}

export interface ActionRuntimeEnvironment extends Record<string, string | undefined> {
  readonly ACTION_RUN_TYPESCRIPT_ACTION_PATH?: string
  readonly ACTION_RUN_TYPESCRIPT_CODE?: string
  readonly ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT?: string
  readonly ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN?: string
  readonly ACTION_RUN_TYPESCRIPT_JOB_CONTEXT?: string
  readonly ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT?: string
  readonly ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT?: string
  readonly ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT?: string
  readonly ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT?: string
  readonly GITHUB_TOKEN?: string
  readonly GITHUB_WORKSPACE?: string
  readonly RUNNER_NAME?: string
}

type MutableActionRuntimeEnvironment = Record<string, string | undefined>

export class ActionRuntime {
  readonly workspace: string

  constructor(readonly environment: ActionRuntimeEnvironment) {
    this.workspace = toForwardSlashPath(path.resolve(environment.GITHUB_WORKSPACE || process.cwd()))
  }

  getBindings(workflowJob?: WorkflowJob): ActionRuntimeBindings {
    return {
      github: this.getGithubContext(),
      job: this.getContext('ACTION_RUN_TYPESCRIPT_JOB_CONTEXT') || {},
      runner: this.getContext('ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT') || {},
      strategy: this.getContext('ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT') || {},
      matrix: this.getContext('ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT') || {},
      steps: this.getStepsContext(workflowJob),
      workflowJob: workflowJob || null,
    }
  }

  getChildProcessEnvironment(token = this.getGitHubToken()): MutableActionRuntimeEnvironment {
    const childEnvironment: MutableActionRuntimeEnvironment = {
      ...(process.env as MutableActionRuntimeEnvironment),
      ...this.environment,
    }
    for (const name of [
      'ACTION_RUN_TYPESCRIPT_ACTION_PATH',
      'ACTION_RUN_TYPESCRIPT_CODE',
      'ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN',
      'ACTION_RUN_TYPESCRIPT_JOB_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT',
    ] as const) {
      delete childEnvironment[name]
    }
    if (token && !childEnvironment.GITHUB_TOKEN) {
      childEnvironment.GITHUB_TOKEN = token
    }
    return childEnvironment
  }

  getCode() {
    const code = this.environment.ACTION_RUN_TYPESCRIPT_CODE
    if (code === undefined) {
      throw new Error('Missing ACTION_RUN_TYPESCRIPT_CODE.')
    }
    return code
  }

  getContext<Value>(name: keyof ActionRuntimeEnvironment & string) {
    return parseJsonString<Value>(this.environment[name], name)
  }

  getGithubContext(): GitHubContext {
    return this.getContext<GitHubContext>('ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT') || {}
  }

  getGitHubToken() {
    return this.environment.ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN || this.getGithubContext().token || undefined
  }

  getStepsContext(workflowJob?: WorkflowJob) {
    const explicitStepsContext = this.getContext('ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT')
    if (explicitStepsContext !== undefined) {
      return explicitStepsContext
    }
    if (workflowJob) {
      return toWorkflowStepsFallback(workflowJob)
    }
    return {}
  }

  async run() {
    const token = this.getGitHubToken()
    const workflowJob = await getCurrentWorkflowJob({
      github: this.getGithubContext(),
      token,
      runnerName: this.environment.RUNNER_NAME,
    })
    const bindings = this.getBindings(workflowJob)
    const suffix = crypto.randomUUID().replaceAll('-', '')
    const contextFile = toForwardSlashPath(path.join(this.workspace, `.action-run-typescript-context-${suffix}.ts`))
    const scriptFile = toForwardSlashPath(path.join(this.workspace, `.action-run-typescript-script-${suffix}.tsx`))
    await Bun.write(contextFile, createContextModuleContent(bindings))
    await Bun.write(scriptFile, createScriptModuleContent(path.basename(contextFile), this.getCode()))
    try {
      const subprocess = Bun.spawn({
        cmd: ['bun', scriptFile],
        cwd: this.workspace,
        env: this.getChildProcessEnvironment(token),
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const exitCode = await subprocess.exited
      if (exitCode !== 0) {
        throw new Error(`Inline TypeScript exited with code ${exitCode}.`)
      }
    } finally {
      await Promise.allSettled([
        rm(scriptFile, {force: true}),
        rm(contextFile, {force: true}),
      ])
    }
  }
}
