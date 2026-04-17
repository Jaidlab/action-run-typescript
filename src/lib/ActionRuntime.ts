import type {ActionRuntimeBindings} from './ActionRuntimeBindings.ts'
import type {GitHubContext, WorkflowJob} from './github/getCurrentWorkflowJob.ts'

import path from 'node:path'

import {getCurrentWorkflowJob} from './github/getCurrentWorkflowJob.ts'
import {toWorkflowStepsFallback} from './github/toWorkflowStepsFallback.ts'
import {NodeModuleRunner} from './node/NodeModuleRunner.ts'
import {parseJsonString} from './parseJsonString.ts'
import {toForwardSlashPath} from './toForwardSlashPath.ts'

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
  readonly GITHUB_API_URL?: string
  readonly GITHUB_JOB?: string
  readonly GITHUB_REPOSITORY?: string
  readonly GITHUB_RUN_ATTEMPT?: string
  readonly GITHUB_RUN_ID?: string
  readonly GITHUB_TOKEN?: string
  readonly GITHUB_WORKSPACE?: string
  readonly INPUT_CODE?: string
  readonly INPUT_GITHUB_CONTEXT?: string
  readonly INPUT_GITHUB_TOKEN?: string
  readonly INPUT_JOB_CONTEXT?: string
  readonly INPUT_MATRIX_CONTEXT?: string
  readonly INPUT_RUNNER_CONTEXT?: string
  readonly INPUT_STEPS?: string
  readonly INPUT_STRATEGY_CONTEXT?: string
  readonly RUNNER_ARCH?: string
  readonly RUNNER_NAME?: string
  readonly RUNNER_OS?: string
  readonly RUNNER_TEMP?: string
  readonly RUNNER_TOOL_CACHE?: string
}

const unresolvedExpressionPattern = /^\s*\$\{\{[\s\S]*\}\}\s*$/

type MutableActionRuntimeEnvironment = Record<string, string | undefined>

export class ActionRuntime {
  readonly environment: ActionRuntimeEnvironment

  readonly workspace: string

  constructor(environment: ActionRuntimeEnvironment) {
    this.environment = environment
    this.workspace = toForwardSlashPath(path.resolve(environment.GITHUB_WORKSPACE || process.cwd()))
  }

  getActionPath() {
    const actionPath = this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_ACTION_PATH')
    if (!actionPath) {
      throw new Error('Missing internal action entry path.')
    }
    return path.resolve(actionPath)
  }

  getBindings(workflowJob?: WorkflowJob): ActionRuntimeBindings {
    return {
      github: this.getGithubContext(),
      job: this.getContext('ACTION_RUN_TYPESCRIPT_JOB_CONTEXT', 'INPUT_JOB_CONTEXT') || {},
      runner: this.getContext('ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT', 'INPUT_RUNNER_CONTEXT') || this.getRunnerContextFromEnvironment(),
      strategy: this.getContext('ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT', 'INPUT_STRATEGY_CONTEXT') || {},
      matrix: this.getContext('ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT', 'INPUT_MATRIX_CONTEXT') || {},
      steps: this.getStepsContext(workflowJob),
      workflowJob: workflowJob || null,
    }
  }

  getCode() {
    const code = this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_CODE', 'INPUT_CODE')
    if (code === undefined) {
      throw new Error('Missing action input "code".')
    }
    return code
  }

  getContext<Value>(...names: Array<keyof ActionRuntimeEnvironment & string>) {
    for (const name of names) {
      const rawValue = this.getEnvironmentValue(name)
      if (rawValue === undefined) {
        continue
      }
      return parseJsonString<Value>(rawValue, name)
    }
  }

  getEnvironmentValue(...names: Array<keyof ActionRuntimeEnvironment & string>) {
    for (const name of names) {
      const value = this.environment[name]
      if (value === undefined || value === '') {
        continue
      }
      if (unresolvedExpressionPattern.test(value)) {
        continue
      }
      return value
    }
  }

  getExecutionEnvironment(token = this.getGitHubToken()): MutableActionRuntimeEnvironment {
    const executionEnvironment: MutableActionRuntimeEnvironment = {
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
      'INPUT_CODE',
      'INPUT_GITHUB_CONTEXT',
      'INPUT_GITHUB_TOKEN',
      'INPUT_JOB_CONTEXT',
      'INPUT_MATRIX_CONTEXT',
      'INPUT_RUNNER_CONTEXT',
      'INPUT_STEPS',
      'INPUT_STRATEGY_CONTEXT',
      'ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS',
      'ACTION_RUN_TYPESCRIPT_INTERNAL_CODE',
      'ACTION_RUN_TYPESCRIPT_INTERNAL_MODE',
    ] as const) {
      delete executionEnvironment[name]
    }
    if (token && !executionEnvironment.GITHUB_TOKEN) {
      executionEnvironment.GITHUB_TOKEN = token
    }
    return executionEnvironment
  }

  getGithubContext(): GitHubContext {
    return this.getContext<GitHubContext>('ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT', 'INPUT_GITHUB_CONTEXT') || this.getGithubContextFromEnvironment()
  }

  getGithubContextFromEnvironment(): GitHubContext {
    return {
      api_url: this.getEnvironmentValue('GITHUB_API_URL'),
      job: this.getEnvironmentValue('GITHUB_JOB'),
      repository: this.getEnvironmentValue('GITHUB_REPOSITORY'),
      run_attempt: this.getEnvironmentValue('GITHUB_RUN_ATTEMPT'),
      run_id: this.getEnvironmentValue('GITHUB_RUN_ID'),
      token: this.getEnvironmentValue('GITHUB_TOKEN'),
    }
  }

  getGitHubToken() {
    return this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN', 'INPUT_GITHUB_TOKEN', 'GITHUB_TOKEN') || this.getGithubContext().token || undefined
  }

  getRunnerContextFromEnvironment() {
    return {
      arch: this.getEnvironmentValue('RUNNER_ARCH'),
      name: this.getEnvironmentValue('RUNNER_NAME'),
      os: this.getEnvironmentValue('RUNNER_OS'),
      temp: this.getEnvironmentValue('RUNNER_TEMP'),
      tool_cache: this.getEnvironmentValue('RUNNER_TOOL_CACHE'),
    }
  }

  getStepsContext(workflowJob?: WorkflowJob) {
    const explicitStepsContext = this.getContext('ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT', 'INPUT_STEPS')
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
      runnerName: this.getEnvironmentValue('RUNNER_NAME'),
    })
    const runner = new NodeModuleRunner({
      actionPath: this.getActionPath(),
      bindings: this.getBindings(workflowJob),
      code: this.getCode(),
      environment: this.getExecutionEnvironment(token),
      workspace: this.workspace,
    })
    await runner.run()
  }
}
