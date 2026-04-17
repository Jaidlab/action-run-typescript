/* eslint-disable typescript/no-floating-promises, typescript/no-restricted-imports */
import type {ActionRuntimeEnvironment} from '../src/lib/ActionRuntime.ts'

import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {describe, it} from 'node:test'

import {getCurrentWorkflowJob} from '../src/lib/github/getCurrentWorkflowJob.ts'
import {toForwardSlashPath} from '../src/lib/toForwardSlashPath.ts'
import runAction from '../src/main.ts'

interface ScriptResult {
  readonly customValue: string
  readonly githubAction: string
  readonly githubRepository: string
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
  customValue,
  githubAction: github.action,
  githubRepository: github.repository,
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
        customValue: 'hello',
        githubAction: 'test-action',
        githubRepository: 'Jaidlab/action-run-typescript',
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
  void it('should expose GitHub Actions file helpers through core', async () => {
    const workspace = await createWorkspace()
    try {
      const outputFile = path.join(workspace, 'github-output.txt')
      const environmentFile = path.join(workspace, 'github-env.txt')
      const pathFile = path.join(workspace, 'github-path.txt')
      const stateFile = path.join(workspace, 'github-state.txt')
      const summaryFile = path.join(workspace, 'github-step-summary.md')
      await runAction(makeEnvironment({
        INPUT_CODE: `core.setOutput('answer', 42)
core.exportVariable('COLOR', 'blue')
core.addPath('./bin')
core.saveState('stateful', {enabled: true})
core.summary.write('# summary')
`,
        GITHUB_ENV: environmentFile,
        GITHUB_OUTPUT: outputFile,
        GITHUB_PATH: pathFile,
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_STATE: stateFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_WORKSPACE: workspace,
      }))
      assert.equal(await readFile(outputFile, 'utf8'), 'answer=42\n')
      assert.equal(await readFile(environmentFile, 'utf8'), 'COLOR=blue\n')
      assert.equal(await readFile(pathFile, 'utf8'), './bin\n')
      assert.equal(await readFile(stateFile, 'utf8'), 'stateful={"enabled":true}\n')
      assert.equal(await readFile(summaryFile, 'utf8'), '# summary')
    } finally {
      await rm(workspace, {
        force: true,
        recursive: true,
      })
    }
  })
  void it('should fail the action when core.setFailed is used', async () => {
    const workspace = await createWorkspace()
    try {
      await assert.rejects(runAction(makeEnvironment({
        INPUT_CODE: "core.setFailed('broken')\n",
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
        INPUT_CODE: `console.log('before')
import {writeFile} from 'node:fs/promises'
import value from './value.ts'
await writeFile('value.txt', String(value))
`,
        GITHUB_REPOSITORY: 'Jaidlab/action-run-typescript',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKSPACE: workspace,
      }))
      assert.equal(await readFile(outputFile, 'utf8'), '41')
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
