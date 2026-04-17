import path from 'node:path'

import {runVmRunner} from './lib/node/runVmRunner.ts'

const entryPath = import.meta.filename
const isMainModule = () => {
  const mainModulePath = process.argv[1]
  if (!mainModulePath) {
    return false
  }
  return path.resolve(mainModulePath) === entryPath
}

export default runVmRunner

if (isMainModule()) {
  await runVmRunner()
}
