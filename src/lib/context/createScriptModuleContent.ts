export const createScriptModuleContent = (contextModuleSpecifier: string, code: string) => [
  `import {core, github, job, matrix, runner, steps, strategy, workflowJob} from ${JSON.stringify(contextModuleSpecifier)}`,
  '',
  code,
  '',
].join('\n')
