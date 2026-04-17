import type {ActionRuntimeBindings} from './ActionRuntimeBindings.ts'
import type {WorkflowJob} from './github/getCurrentWorkflowJob.ts'
import type {ToolkitGitHubContext} from './github/toActionRuntimeGitHubContext.ts'
import type {InputOptions} from '@actions/core'

import path from 'node:path'

import * as actionCore from '@actions/core'
import * as actionGithub from '@actions/github'
import json5 from 'json5'

import {actionInputNames,
  deprecatedContextEnvironmentNames,
  getEnvironmentValue,
  legacyActionRuntimeInputEnvironmentNames,
  normalizeEnvironmentValue,
  toInputEnvironmentName} from './environment.ts'
import {getCurrentWorkflowJob} from './github/getCurrentWorkflowJob.ts'
import {toActionRuntimeGitHubContext} from './github/toActionRuntimeGitHubContext.ts'
import {toWorkflowStepsFallback} from './github/toWorkflowStepsFallback.ts'
import {NodeModuleRunner} from './node/NodeModuleRunner.ts'
import {RspackInlineScriptBundler} from './rspack/RspackInlineScriptBundler.ts'
import {toForwardSlashPath} from './toForwardSlashPath.ts'
import {withPatchedProcessEnvironment} from './withPatchedProcessEnvironment.ts'

export interface ActionRuntimeEnvironment extends Record<string, string | undefined> {
  readonly ACTION_RUN_TYPESCRIPT_CODE?: string
  readonly ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN?: string
  readonly ACTION_RUN_TYPESCRIPT_GLOBALS?: string
  readonly GITHUB_TOKEN?: string
  readonly GITHUB_WORKSPACE?: string
  readonly INPUT_CODE?: string
  readonly 'INPUT_GITHUB-TOKEN'?: string
  readonly INPUT_GLOBALS?: string
  readonly RUNNER_ARCH?: string
  readonly RUNNER_NAME?: string
  readonly RUNNER_OS?: string
  readonly RUNNER_TEMP?: string
  readonly RUNNER_TOOL_CACHE?: string
}

type MutableActionRuntimeEnvironment = Record<string, string | undefined>

type ActionExecutionState = {
  readonly bindings: ActionRuntimeBindings
  readonly code: string
  readonly globals: Record<string, unknown>
  readonly token?: string
}

const createToolkitGitHubContext = () => {
  const GitHubContext = actionGithub.context.constructor as new () => ToolkitGitHubContext
  return new GitHubContext
}
const toJobContext = (githubJobId: string | undefined, workflowJob?: WorkflowJob) => {
  const job: Record<string, unknown> = {}
  if (githubJobId) {
    job.id = githubJobId
  }
  if (!workflowJob) {
    return job
  }
  if (workflowJob.id !== undefined) {
    job.workflow_job_id = workflowJob.id
    job.workflowJobId = workflowJob.id
  }
  if (workflowJob.name !== undefined) {
    job.name = workflowJob.name
  }
  if (workflowJob.status !== undefined) {
    job.status = workflowJob.status
  }
  if (workflowJob.conclusion !== undefined) {
    job.conclusion = workflowJob.conclusion
  }
  const url = workflowJob.html_url ?? workflowJob.url
  if (url !== undefined) {
    job.url = url
  }
  return job
}
const resolveRunnerOperatingSystem = () => {
  const platform = actionCore.platform
  if (platform.isWindows) {
    return 'Windows'
  }
  if (platform.isMacOS) {
    return 'macOS'
  }
  if (platform.isLinux) {
    return 'Linux'
  }
  return platform.platform
}

export class ActionRuntime {
  readonly environment: ActionRuntimeEnvironment

  readonly workspace: string

  constructor(environment: ActionRuntimeEnvironment) {
    this.environment = environment
    this.workspace = toForwardSlashPath(path.resolve(environment.GITHUB_WORKSPACE || process.cwd()))
  }

  createBundler() {
    return new RspackInlineScriptBundler({
      tempFolder: this.getEnvironmentValue('RUNNER_TEMP'),
      workspace: this.workspace,
    })
  }

  async createExecutionState(): Promise<ActionExecutionState> {
    return withPatchedProcessEnvironment(this.environment, async () => {
      const code = this.getCode()
      const globals = this.parseGlobals()
      const token = this.getGitHubToken()
      const toolkitGitHubContext = createToolkitGitHubContext()
      const github = toActionRuntimeGitHubContext(toolkitGitHubContext, token)
      const workflowJob = await getCurrentWorkflowJob({
        github,
        runnerName: this.getEnvironmentValue('RUNNER_NAME'),
        token,
      })
      return {
        bindings: {
          github,
          job: toJobContext(toolkitGitHubContext.job, workflowJob),
          matrix: {},
          runner: this.getRunnerContext(),
          steps: workflowJob ? toWorkflowStepsFallback(workflowJob) : {},
          strategy: {},
          workflowJob: workflowJob ?? null,
        },
        code,
        globals,
        token,
      }
    })
  }

  getActionInput(name: string, options?: InputOptions) {
    return normalizeEnvironmentValue(actionCore.getInput(name, options))
  }

  getCode() {
    const code = this.getActionInput('code', {trimWhitespace: false}) ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_CODE')
    if (code === undefined) {
      throw new Error('Missing action input "code".')
    }
    return code
  }

  getEnvironmentValue(...names: Array<string>) {
    return getEnvironmentValue(this.environment, ...names)
  }

  getExecutionEnvironment(token = this.getGitHubToken()) {
    const executionEnvironment: MutableActionRuntimeEnvironment = {
      ...(process.env as MutableActionRuntimeEnvironment),
      ...this.environment,
    }
    for (const name of [
      ...deprecatedContextEnvironmentNames,
      ...legacyActionRuntimeInputEnvironmentNames,
      ...actionInputNames.map(toInputEnvironmentName),
    ]) {
      delete executionEnvironment[name]
    }
    if (token && !executionEnvironment.GITHUB_TOKEN) {
      executionEnvironment.GITHUB_TOKEN = token
    }
    return executionEnvironment
  }

  getGitHubToken() {
    return this.getActionInput('github-token', {trimWhitespace: false})
      ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN', 'GITHUB_TOKEN')
  }

  getRunnerContext() {
    return {
      arch: this.getEnvironmentValue('RUNNER_ARCH') ?? actionCore.platform.arch,
      debug: actionCore.isDebug(),
      name: this.getEnvironmentValue('RUNNER_NAME'),
      os: this.getEnvironmentValue('RUNNER_OS') ?? resolveRunnerOperatingSystem(),
      temp: this.getEnvironmentValue('RUNNER_TEMP'),
      tool_cache: this.getEnvironmentValue('RUNNER_TOOL_CACHE'),
    }
  }

  parseGlobals() {
    const rawGlobals = this.getActionInput('globals', {trimWhitespace: false}) ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GLOBALS')
    if (rawGlobals === undefined || rawGlobals.trim() === '') {
      return {}
    }
    let parsed: unknown
    try {
      parsed = json5.parse(rawGlobals)
    } catch (error) {
      throw new Error('Failed to parse action input "globals".', {cause: error})
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Action input "globals" must evaluate to an object.')
    }
    return parsed as Record<string, unknown>
  }

  async run() {
    const executionState = await this.createExecutionState()
    const bundle = await this.createBundler().bundle(executionState.code)
    const runner = new NodeModuleRunner({
      bindings: executionState.bindings,
      bundle,
      environment: this.getExecutionEnvironment(executionState.token),
      globals: executionState.globals,
      workspace: this.workspace,
    })
    await runner.run()
  }
}
