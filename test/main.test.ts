/* eslint-disable typescript/no-floating-promises, typescript/no-restricted-imports */
import type {ActionRuntimeEnvironment} from '../src/lib/ActionRuntime.ts'

import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {describe, it} from 'node:test'

import {getCurrentWorkflowJob} from '../src/lib/github/getCurrentWorkflowJob.ts'
import {toForwardSlashPath} from '../src/lib/toForwardSlashPath.ts'
import runAction from '../src/main.ts'

interface ScriptResult {
  readonly coreInfo: string
  readonly currentWorkingDirectory: string
  readonly customValue: string
  readonly githubAction: string
  readonly githubRepository: string
  readonly globalCustomValue: string
  readonly imported: number
  readonly jobId: string
  readonly matrixNode: string
  readonly packageName: string
  readonly runnerOs: string
  readonly stepValue: string
}
const createWorkspace = async () => toForwardSlashPath(await mkdtemp(path.join(os.tmpdir(), 'action-run-typescript-')))
const makeEnvironment = (overrides: ActionRuntimeEnvironment = {}): ActionRuntimeEnvironment => ({
  ...(process.env as ActionRuntimeEnvironment),
  ...overrides,
})
const normalizeLineEndings = (value: string) => value.replaceAll('\r\n', '\n')
const parseWorkflowCommandFile = (content: string) => {
  const entries: Record<string, string> = {}
  const lines = normalizeLineEndings(content).split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line) {
      index++
      continue
    }
    const heredocMatch = /^(?<name>[^<]+)<<(?<delimiter>.+)$/.exec(line)
    if (heredocMatch?.groups) {
      const {delimiter, name} = heredocMatch.groups
      const chunks: Array<string> = []
      index++
      while (index < lines.length && lines[index] !== delimiter) {
        chunks.push(lines[index])
        index++
      }
      assert.notEqual(index, lines.length, `Missing workflow command delimiter ${delimiter}.`)
      entries[name] = chunks.join('\n')
      index++
      continue
    }
    const equalsIndex = line.indexOf('=')
    assert.notEqual(equalsIndex, -1, `Invalid workflow command line: ${line}`)
    entries[line.slice(0, equalsIndex)] = line.slice(equalsIndex + 1)
    index++
  }
  return entries
}
const writeFakeReactJsxRuntime = async (workspace: string) => {
  const reactFolder = path.join(workspace, 'node_modules', 'react')
  await mkdir(reactFolder, {recursive: true})
  await writeFile(path.join(reactFolder, 'package.json'), JSON.stringify({
    exports: {
      './jsx-dev-runtime': './jsx-dev-runtime.js',
      './jsx-runtime': './jsx-runtime.js',
    },
    name: 'react',
    type: 'module',
  }, null, 2))
  await writeFile(path.join(reactFolder, 'jsx-runtime.js'), `export const jsx = (tag, props) => ({tag, props})
export const jsxs = jsx
export const Fragment = Symbol.for('react.fragment')
`)
  await writeFile(path.join(reactFolder, 'jsx-dev-runtime.js'), `export const jsxDEV = (tag, props) => ({tag, props})
export const Fragment = Symbol.for('react.fragment')
`)
}
void describe('action-run-typescript', () => {
  void it('should run inline TypeScript with contextual bindings, globals and relative imports', async () => {
    const workspace = await createWorkspace()
    try {
      await writeFile(path.join(workspace, 'package.json'), JSON.stringify({name: 'workspace-package'}, null, 2))
      await writeFile(path.join(workspace, 'value.ts'), 'export default 41\n')
      const outputFile = path.join(workspace, 'result.json')
      await runAction(makeEnvironment({
        INPUT_CODE: `import {writeFile} from 'node:fs/promises'
import packageJson from './package.json'
import value from './value.ts'
await writeFile('result.json', JSON.stringify({
  coreInfo: typeof core.info,
  currentWorkingDirectory: process.cwd(),
  customValue,
  githubAction: github.action,
  githubRepository: github.repository,
  globalCustomValue: globalThis.customValue,
  imported: value,
  jobId: job.id,
  matrixNode: matrix.node,
  packageName: packageJson.name,
  runnerOs: runner.os,
  stepValue: steps.prepare.outputs.value,
}, null, 2))
`,
        INPUT_GLOBALS: `{
  customValue: 'hello',
  matrix: {node: '22'},
  steps: {prepare: {outputs: {value: '42'}}},
  // json5 comment support
}`,
        GITHUB_ACTION: 'test-action',
        GITHUB_JOB: 'test-job',
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
        RUNNER_OS: 'Linux',
      }))
      const result = JSON.parse(await readFile(outputFile, 'utf8')) as ScriptResult
      assert.deepEqual(result, {
        coreInfo: 'function',
        currentWorkingDirectory: path.normalize(workspace),
        customValue: 'hello',
        githubAction: 'test-action',
        githubRepository: 'Jaidlab/action-run-typescript',
        globalCustomValue: 'hello',
        imported: 41,
        jobId: 'test-job',
        matrixNode: '22',
        packageName: 'workspace-package',
        runnerOs: 'Linux',
        stepValue: '42',
      })
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should run inline TSX and local TSX imports before evaluation', async () => {
    const workspace = await createWorkspace()
    try {
      await writeFakeReactJsxRuntime(workspace)
      await writeFile(path.join(workspace, 'component.tsx'), 'export default <div>{matrix.node}</div>\n')
      const outputFile = path.join(workspace, 'tsx.json')
      await runAction(makeEnvironment({
        INPUT_CODE: `import {writeFile} from 'node:fs/promises'
import component from './component.tsx'
const inlineComponent = <section>{matrix.node}</section>
await writeFile('tsx.json', JSON.stringify({
  component,
  inlineComponent,
}))
`,
        INPUT_GLOBALS: '{matrix: {node: 22}}',
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.deepEqual(JSON.parse(await readFile(outputFile, 'utf8')), {
        component: {
          props: {
            children: 22,
          },
          tag: 'div',
        },
        inlineComponent: {
          props: {
            children: 22,
          },
          tag: 'section',
        },
      })
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should allow imports from the action image dependencies', async () => {
    const workspace = await createWorkspace()
    try {
      const outputFile = path.join(workspace, 'dependencies.json')
      await runAction(makeEnvironment({
        INPUT_CODE: `import * as core from '@actions/core'
import {camelCase} from 'es-toolkit'
import fs from 'fs-extra'
import {globby} from 'globby'

await fs.writeJson('dependencies.json', {
  camelCase: camelCase('hello world'),
  coreGetInput: typeof core.getInput,
  fsReadJson: typeof fs.readJson,
  globby: typeof globby,
})
`,
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.deepEqual(JSON.parse(await readFile(outputFile, 'utf8')), {
        camelCase: 'helloWorld',
        coreGetInput: 'function',
        fsReadJson: 'function',
        globby: 'function',
      })
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should allow selecting no built-in goodies while keeping explicit globals', async () => {
    const workspace = await createWorkspace()
    try {
      const outputFile = path.join(workspace, 'goodies.json')
      await runAction(makeEnvironment({
        INPUT_CODE: `import {writeFile} from 'node:fs/promises'
await writeFile('goodies.json', JSON.stringify({
  core: typeof core,
  github: typeof github,
  job: typeof job,
  matrix: typeof matrix,
  runner: typeof runner,
  steps: typeof steps,
  strategy: typeof strategy,
  workflowJob: typeof workflowJob,
  throughGlobalThisCore: typeof globalThis.core,
  throughGlobalThisGithub: typeof globalThis.github,
  customValue,
  throughGlobalThisCustomValue: globalThis.customValue,
}))
`,
        INPUT_GLOBALS: `{
  customValue: 'hello',
}`,
        INPUT_GOODIES: '[]',
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.deepEqual(JSON.parse(await readFile(outputFile, 'utf8')), {
        core: 'undefined',
        github: 'undefined',
        job: 'undefined',
        matrix: 'undefined',
        runner: 'undefined',
        steps: 'undefined',
        strategy: 'undefined',
        workflowJob: 'undefined',
        throughGlobalThisCore: 'undefined',
        throughGlobalThisGithub: 'undefined',
        customValue: 'hello',
        throughGlobalThisCustomValue: 'hello',
      })
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should allow selecting a subset of built-in goodies', async () => {
    const workspace = await createWorkspace()
    try {
      const outputFile = path.join(workspace, 'subset-goodies.json')
      await runAction(makeEnvironment({
        INPUT_CODE: `import {writeFile} from 'node:fs/promises'
await writeFile('subset-goodies.json', JSON.stringify({
  coreInfo: typeof core.info,
  github: typeof github,
  job: typeof job,
  matrix: typeof matrix,
  runner: typeof runner,
  steps: typeof steps,
  strategy: typeof strategy,
  workflowJob: typeof workflowJob,
}))
`,
        INPUT_GOODIES: 'core, matrix',
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.deepEqual(JSON.parse(await readFile(outputFile, 'utf8')), {
        coreInfo: 'function',
        github: 'undefined',
        job: 'undefined',
        matrix: 'object',
        runner: 'undefined',
        steps: 'undefined',
        strategy: 'undefined',
        workflowJob: 'undefined',
      })
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should fail the action when the child process exits with code 1', async () => {
    const workspace = await createWorkspace()
    try {
      await assert.rejects(runAction(makeEnvironment({
        INPUT_CODE: 'process.exit(1)\n',
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      })), /Inline TypeScript exited with code 1\./)
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should allow static imports after other top-level statements', async () => {
    const workspace = await createWorkspace()
    try {
      await writeFile(path.join(workspace, 'value.ts'), 'export default 41\n')
      const outputFile = path.join(workspace, 'value.txt')
      await runAction(makeEnvironment({
        INPUT_CODE: `const before = 1
import {writeFile} from 'node:fs/promises'
import value from './value.ts'
await writeFile('value.txt', String(before + value))
`,
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.equal(await readFile(outputFile, 'utf8'), '42')
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
})
void describe('getCurrentWorkflowJob', () => {
  void it('should resolve the current job by exact GitHub job name', async () => {
    const job = await getCurrentWorkflowJob({
      fetch: async () => Response.json({
        jobs: [
          {
            name: 'lint',
            status: 'completed',
          },
          {
            name: 'test',
            status: 'in_progress',
          },
        ],
      }),
      github: {
        job: 'test',
        repository: 'Jaidlab/action-run-typescript',
        run_id: 1,
      },
      token: 'token',
    })
    assert.equal(job?.name, 'test')
  })
  void it('should resolve the current job by runner name when job names are ambiguous', async () => {
    const job = await getCurrentWorkflowJob({
      fetch: async () => Response.json({
        jobs: [
          {
            name: 'build',
            runner_name: 'runner-a',
            status: 'in_progress',
          },
          {
            name: 'build',
            runner_name: 'runner-b',
            status: 'in_progress',
          },
        ],
      }),
      github: {
        job: 'build',
        repository: 'Jaidlab/action-run-typescript',
        run_id: 1,
      },
      runnerName: 'runner-b',
      token: 'token',
    })
    assert.equal(job?.runner_name, 'runner-b')
  })
})
