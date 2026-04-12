export const createScriptModuleContent = (contextModuleFileName: string, code: string) => [
  `import {core, github, job, matrix, runner, steps, strategy, workflowJob} from './${contextModuleFileName}'`,
  '',
  code,
  '',
].join('\n')
