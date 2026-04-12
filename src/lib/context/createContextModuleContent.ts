import {serializeCodeLiteral} from '../serializeCodeLiteral.ts'
import {createCoreModuleSource} from './createCoreModuleSource.ts'

export interface ContextModuleBindings {
  readonly github: unknown
  readonly job: unknown
  readonly matrix: unknown
  readonly runner: unknown
  readonly steps: unknown
  readonly strategy: unknown
  readonly workflowJob: unknown
}

export const createContextModuleContent = (bindings: ContextModuleBindings) => [
  "import {appendFileSync, writeFileSync} from 'node:fs'",
  '',
  createCoreModuleSource(),
  '',
  `export const github = ${serializeCodeLiteral(bindings.github)}`,
  `export const job = ${serializeCodeLiteral(bindings.job)}`,
  `export const runner = ${serializeCodeLiteral(bindings.runner)}`,
  `export const strategy = ${serializeCodeLiteral(bindings.strategy)}`,
  `export const matrix = ${serializeCodeLiteral(bindings.matrix)}`,
  `export const steps = ${serializeCodeLiteral(bindings.steps)}`,
  `export const workflowJob = ${serializeCodeLiteral(bindings.workflowJob)}`,
  '',
].join('\n')
