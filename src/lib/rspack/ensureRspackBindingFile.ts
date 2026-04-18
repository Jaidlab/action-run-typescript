import {spawn, spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface EnsureRspackBindingFileOptions {
  readonly cacheRootFolder?: string
  readonly version: string
}

interface RspackBindingDescriptor {
  readonly fileName: string
  readonly packageName: string
}
const toChildEnvironment = (environment: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(environment)
  .filter(([, value]) => value !== undefined)) as Record<string, string>
const isFileMusl = (file: string) => file.includes('libc.musl-') || file.includes('ld-musl-')
const isMuslFromChildProcess = () => {
  try {
    return spawnSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout.includes('musl')
  } catch {
    return false
  }
}
const isMuslFromFilesystem = () => {
  try {
    return readFileSync('/usr/bin/ldd', 'utf8').includes('musl')
  } catch {
    return null
  }
}
const isMusl = () => {
  if (process.platform !== 'linux') {
    return false
  }
  return isMuslFromFilesystem() ?? isMuslFromChildProcess()
}
const getNpmExecutable = () => {
  const fileName = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const siblingFile = path.join(path.dirname(process.execPath), fileName)
  if (existsSync(siblingFile)) {
    return siblingFile
  }
  return fileName
}
const spawnNpm = (args: Array<string>, options: Parameters<typeof spawn>[2]) => {
  const npmExecutable = getNpmExecutable()
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', npmExecutable, ...args], options)
  }
  return spawn(npmExecutable, args, options)
}
const getRspackBindingDescriptor = (): RspackBindingDescriptor => {
  switch (process.platform) {
    case 'darwin': {
      switch (process.arch) {
        case 'arm64': {
          return {
            fileName: 'rspack.darwin-arm64.node',
            packageName: '@rspack/binding-darwin-arm64',
          }
        }
        case 'x64': {
          return {
            fileName: 'rspack.darwin-x64.node',
            packageName: '@rspack/binding-darwin-x64',
          }
        }
      }
      break
    }
    case 'linux': {
      const libc = isMusl() ? 'musl' : 'gnu'
      switch (process.arch) {
        case 'arm64': {
          return {
            fileName: `rspack.linux-arm64-${libc}.node`,
            packageName: `@rspack/binding-linux-arm64-${libc}`,
          }
        }
        case 'x64': {
          return {
            fileName: `rspack.linux-x64-${libc}.node`,
            packageName: `@rspack/binding-linux-x64-${libc}`,
          }
        }
      }
      break
    }
    case 'win32': {
      switch (process.arch) {
        case 'arm64': {
          return {
            fileName: 'rspack.win32-arm64-msvc.node',
            packageName: '@rspack/binding-win32-arm64-msvc',
          }
        }
        case 'x64': {
          return {
            fileName: 'rspack.win32-x64-msvc.node',
            packageName: '@rspack/binding-win32-x64-msvc',
          }
        }
      }
      break
    }
  }
  throw new Error(`Unsupported platform or architecture for the published Rspack runtime: ${process.platform}/${process.arch}. Supported targets are linux-x64, linux-arm64, win32-x64, win32-arm64, darwin-x64 and darwin-arm64.`)
}
const waitForChildProcess = (child: ReturnType<typeof spawn>) => new Promise<{exitCode: number | null
  signal: NodeJS.Signals | null}>((resolve, reject) => {
  child.once('error', reject)
  child.once('close', (exitCode, signal) => {
    resolve({
      exitCode,
      signal,
    })
  })
})
const installRspackBindingPackage = async ({installationFolder,
  packageName,
  version}: {installationFolder: string
  packageName: string
  version: string}) => {
  const stdoutChunks: Array<string> = []
  const stderrChunks: Array<string> = []
  const child = spawnNpm([
    'install',
    '--loglevel=error',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--no-save',
    '--ignore-scripts',
    '--prefer-offline',
    '--prefix',
    installationFolder,
    `${packageName}@${version}`,
  ], {
    env: toChildEnvironment({
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_loglevel: 'error',
      npm_config_update_notifier: 'false',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout = child.stdout
  const stderr = child.stderr
  stdout.setEncoding('utf8')
  stderr.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    stdoutChunks.push(chunk)
  })
  stderr.on('data', (chunk: string) => {
    stderrChunks.push(chunk)
  })
  const {exitCode, signal} = await waitForChildProcess(child)
  if (signal) {
    throw new Error(`npm install for ${packageName}@${version} was terminated by signal ${signal}.`)
  }
  const normalizedExitCode = exitCode ?? 0
  if (normalizedExitCode === 0) {
    return
  }
  const output = [stderrChunks.join('').trim(), stdoutChunks.join('').trim()].filter(Boolean).join('\n\n')
  throw new Error(output ? `Failed to install ${packageName}@${version} for the published Rspack runtime.\n\n${output}` : `Failed to install ${packageName}@${version} for the published Rspack runtime with exit code ${normalizedExitCode}.`)
}

export const ensureRspackBindingFile = async ({cacheRootFolder = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'action-run-typescript', 'rspack-binding-cache'),
  version}: EnsureRspackBindingFileOptions) => {
  const descriptor = getRspackBindingDescriptor()
  const packageCacheFolder = path.join(cacheRootFolder, version, descriptor.packageName.replaceAll('/', '__'))
  const bindingFile = path.join(packageCacheFolder, descriptor.fileName)
  if (existsSync(bindingFile)) {
    return bindingFile
  }
  mkdirSync(packageCacheFolder, {recursive: true})
  const installationFolder = mkdtempSync(path.join(packageCacheFolder, 'install-'))
  try {
    await installRspackBindingPackage({
      installationFolder,
      packageName: descriptor.packageName,
      version,
    })
    const installedBindingFile = path.join(installationFolder, 'node_modules', ...descriptor.packageName.split('/'), descriptor.fileName)
    if (!existsSync(installedBindingFile)) {
      throw new Error(`Installed package ${descriptor.packageName}@${version} does not contain ${descriptor.fileName}.`)
    }
    if (!existsSync(bindingFile)) {
      const temporaryBindingFile = path.join(packageCacheFolder, `${descriptor.fileName}.${randomUUID()}.tmp`)
      copyFileSync(installedBindingFile, temporaryBindingFile)
      try {
        renameSync(temporaryBindingFile, bindingFile)
      } catch (error) {
        rmSync(temporaryBindingFile, {force: true})
        if (!existsSync(bindingFile)) {
          throw error
        }
      }
    }
    return bindingFile
  } finally {
    rmSync(installationFolder, {
      force: true,
      recursive: true,
    })
  }
}
