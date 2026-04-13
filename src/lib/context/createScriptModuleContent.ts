import {splitLeadingImportBlock} from './splitLeadingImportBlock.ts'

const findStaticImportStatements = (code: string) => new Bun.Transpiler({loader: 'tsx'}).scanImports(code).filter(importEntry => importEntry.kind === 'import-statement')

export const createScriptModuleContent = (contextModuleSpecifier: string, code: string) => {
  const {body, imports} = splitLeadingImportBlock(code)
  const remainingStaticImports = findStaticImportStatements(body)
  if (remainingStaticImports.length) {
    throw new Error('Static import statements must be placed at the top of the inline TypeScript script.')
  }
  const parts = imports ? [imports.trimEnd()] : []
  parts.push(`import {core, github, job, matrix, runner, steps, strategy, workflowJob} from ${JSON.stringify(contextModuleSpecifier)}`, '', 'export default (async () => {', body, '})()', '')
  return parts.join('\n')
}
