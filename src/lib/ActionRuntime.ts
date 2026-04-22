import type {ActionRuntimeBindings} from './ActionRuntimeBindings.ts'
import type {ActionRuntimeGoodieName} from './ActionRuntimeGoodie.ts'
import type {WorkflowJob} from './github/getCurrentWorkflowJob.ts'
import type {ToolkitGitHubContext} from './github/toActionRuntimeGitHubContext.ts'
import type {InputOptions} from '@actions/core'

import path from 'node:path'

import * as actionCore from '@actions/core'
import * as actionGithub from '@actions/github'

import {actionRuntimeGoodieNamesText, createAllActionRuntimeGoodies, parseActionRuntimeGoodies} from './ActionRuntimeGoodie.ts'
import {BunInlineScriptRunner} from './bun/BunInlineScriptRunner.ts'
import {BunTemporaryDependenciesInstaller} from './bun/BunTemporaryDependenciesInstaller.ts'
import {getEnvironmentValue, normalizeEnvironmentValue, scrubbedEnvironmentNames} from './environment.ts'
import {getCurrentWorkflowJob} from './github/getCurrentWorkflowJob.ts'
import {toActionRuntimeGitHubContext} from './github/toActionRuntimeGitHubContext.ts'
import {toWorkflowStepsFallback} from './github/toWorkflowStepsFallback.ts'
import {toForwardSlashPath} from './toForwardSlashPath.ts'
import {withPatchedProcessEnvironment} from './withPatchedProcessEnvironment.ts'

export interface ActionRuntimeEnvironment extends Record<string, string | undefined> {
  readonly ACTION_RUN_TYPESCRIPT_CODE?: string
  readonly ACTION_RUN_TYPESCRIPT_DEPENDENCIES?: string
  readonly ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN?: string
  readonly ACTION_RUN_TYPESCRIPT_GLOBALS?: string
  readonly ACTION_RUN_TYPESCRIPT_GOODIES?: string
  readonly ACTION_RUN_TYPESCRIPT_INJECT_GOODIES?: string
  readonly GITHUB_TOKEN?: string
  readonly GITHUB_WORKSPACE?: string
  readonly INPUT_CODE?: string
  readonly INPUT_DEPENDENCIES?: string
  readonly 'INPUT_GITHUB-TOKEN'?: string
  readonly INPUT_GLOBALS?: string
  readonly INPUT_GOODIES?: string
  readonly INPUT_INJECTGOODIES?: string
  readonly NODE_PATH?: string
  readonly RUNNER_ARCH?: string
  readonly RUNNER_NAME?: string
  readonly RUNNER_OS?: string
  readonly RUNNER_TEMP?: string
  readonly RUNNER_TOOL_CACHE?: string
}

type MutableActionRuntimeEnvironment = Record<string, string | undefined>
type MutableActionRuntimeBindings = {-readonly [Name in keyof ActionRuntimeBindings]?: ActionRuntimeBindings[Name]}

type ActionExecutionState = {
  readonly bindings: ActionRuntimeBindings
  readonly code: string
  readonly dependencies?: string
  readonly globalsSource?: string
  readonly goodies: ReadonlySet<ActionRuntimeGoodieName>
  readonly token?: string
}

const falseBooleanInputValues = ['false', 'False', 'FALSE'] as const
const trueBooleanInputValues = ['true', 'True', 'TRUE'] as const
const actionRootFolder = path.resolve(import.meta.dirname, '../..')
const actionNodeModulesFolder = path.join(actionRootFolder, 'node_modules')
const appendPathListEntry = (value: string | undefined, entry: string) => {
  const previousEntries = value ? value.split(path.delimiter) : []
  const entries = [...previousEntries, entry].filter(Boolean)
  return [...new Set(entries)].join(path.delimiter)
}
const createToolkitGitHubContext = () => {
  const GitHubContext = actionGithub.context.constructor as new () => ToolkitGitHubContext
  return new GitHubContext
}
const hasAnyActionRuntimeGoodie = (goodies: ReadonlySet<ActionRuntimeGoodieName>, names: ReadonlyArray<ActionRuntimeGoodieName>) => names.some(name => goodies.has(name))
const parseLegacyInjectGoodies = (rawInjectGoodies: string) => {
  const normalizedInjectGoodies = rawInjectGoodies.trim()
  if (trueBooleanInputValues.includes(normalizedInjectGoodies as typeof trueBooleanInputValues[number])) {
    return createAllActionRuntimeGoodies()
  }
  if (falseBooleanInputValues.includes(normalizedInjectGoodies as typeof falseBooleanInputValues[number])) {
    return new Set<ActionRuntimeGoodieName>
  }
  throw new TypeError(`Legacy action input "injectGoodies" must be a boolean. Supported values: true, True, TRUE, false, False and FALSE. Use action input "goodies" with any combination of ${actionRuntimeGoodieNamesText}, or [] for none.`)
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

export class ActionRuntime {
  readonly environment: ActionRuntimeEnvironment

  readonly workspace: string

  constructor(environment: ActionRuntimeEnvironment) {
    this.environment = environment
    this.workspace = toForwardSlashPath(path.resolve(environment.GITHUB_WORKSPACE || process.cwd()))
  }

  async createExecutionState(): Promise<ActionExecutionState> {
    return withPatchedProcessEnvironment(this.environment, async () => {
      const code = this.getCode()
      const dependencies = this.getDependencies()
      const goodies = this.getGoodies()
      const globalsSource = this.getGlobalsSource()
      const token = this.getGitHubToken()
      if (!goodies.size) {
        return {
          bindings: {},
          code,
          dependencies,
          globalsSource,
          goodies,
          token,
        }
      }
      const needsGitHubContext = hasAnyActionRuntimeGoodie(goodies, ['github', 'job', 'steps', 'workflowJob'])
      const toolkitGitHubContext = needsGitHubContext ? createToolkitGitHubContext() : undefined
      const github = toolkitGitHubContext ? toActionRuntimeGitHubContext(toolkitGitHubContext, token) : undefined
      const needsWorkflowJob = hasAnyActionRuntimeGoodie(goodies, ['job', 'steps', 'workflowJob'])
      const workflowJob = needsWorkflowJob && github ? await getCurrentWorkflowJob({
        github,
        runnerName: this.getEnvironmentValue('RUNNER_NAME'),
        token,
      }) : undefined
      const bindings: MutableActionRuntimeBindings = {}
      if (goodies.has('github') && github) {
        bindings.github = github
      }
      if (goodies.has('job')) {
        bindings.job = toJobContext(toolkitGitHubContext?.job, workflowJob)
      }
      if (goodies.has('matrix')) {
        bindings.matrix = {}
      }
      if (goodies.has('runner')) {
        bindings.runner = this.getRunnerContext()
      }
      if (goodies.has('steps')) {
        bindings.steps = workflowJob ? toWorkflowStepsFallback(workflowJob) : {}
      }
      if (goodies.has('strategy')) {
        bindings.strategy = {}
      }
      if (goodies.has('workflowJob')) {
        bindings.workflowJob = workflowJob ?? null
      }
      return {
        bindings,
        code,
        dependencies,
        globalsSource,
        goodies,
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

  getDependencies() {
    const dependencies = this.getActionInput('dependencies', {trimWhitespace: false}) ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_DEPENDENCIES')
    if (dependencies === undefined || dependencies.trim() === '') {
      return
    }
    return dependencies
  }

  getEnvironmentValue(...names: ReadonlyArray<string>) {
    return getEnvironmentValue(this.environment, ...names)
  }

  getExecutionEnvironment({dependenciesNodeModulesFolder, token}: {dependenciesNodeModulesFolder?: string
    token?: string} = {}) {
    const executionEnvironment: MutableActionRuntimeEnvironment = {
      ...(process.env as MutableActionRuntimeEnvironment),
      ...this.environment,
    }
    for (const name of scrubbedEnvironmentNames) {
      delete executionEnvironment[name]
    }
    if (token && !executionEnvironment.GITHUB_TOKEN) {
      executionEnvironment.GITHUB_TOKEN = token
    }
    if (dependenciesNodeModulesFolder) {
      executionEnvironment.NODE_PATH = appendPathListEntry(executionEnvironment.NODE_PATH, dependenciesNodeModulesFolder)
    }
    executionEnvironment.NODE_PATH = appendPathListEntry(executionEnvironment.NODE_PATH, actionNodeModulesFolder)
    return executionEnvironment
  }

  getGitHubToken() {
    return this.getActionInput('github-token', {trimWhitespace: false})
      ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN', 'GITHUB_TOKEN')
  }

  getGlobalsSource() {
    const globalsSource = this.getActionInput('globals', {trimWhitespace: false}) ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GLOBALS')
    if (globalsSource === undefined || globalsSource.trim() === '') {
      return
    }
    return globalsSource
  }

  getGoodies() {
    const rawGoodies = this.getActionInput('goodies', {trimWhitespace: false})
      ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_GOODIES')
    if (rawGoodies !== undefined) {
      return parseActionRuntimeGoodies(rawGoodies)
    }
    const rawInjectGoodies = this.getActionInput('injectGoodies')
      ?? this.getEnvironmentValue('ACTION_RUN_TYPESCRIPT_INJECT_GOODIES')
    if (rawInjectGoodies !== undefined) {
      return parseLegacyInjectGoodies(rawInjectGoodies)
    }
    return createAllActionRuntimeGoodies()
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

  async run() {
    const executionState = await this.createExecutionState()
    const preparedDependencies = executionState.dependencies ? new BunTemporaryDependenciesInstaller({
      environment: this.getExecutionEnvironment({token: executionState.token}),
      rawDependencies: executionState.dependencies,
      runnerTemp: this.getEnvironmentValue('RUNNER_TEMP'),
    }).prepare() : undefined
    try {
      const runner = new BunInlineScriptRunner({
        bindings: executionState.bindings,
        code: executionState.code,
        environment: this.getExecutionEnvironment({
          dependenciesNodeModulesFolder: preparedDependencies?.nodeModulesFolder,
          token: executionState.token,
        }),
        globalsSource: executionState.globalsSource,
        goodies: executionState.goodies,
        workspace: this.workspace,
      })
      await runner.run()
    } finally {
      preparedDependencies?.cleanup()
    }
  }
}
