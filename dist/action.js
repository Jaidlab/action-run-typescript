// src/main.ts
import path4 from "node:path";

// src/lib/ActionRuntime.ts
import path2 from "node:path";

// src/lib/github/getCurrentWorkflowJob.ts
var listWorkflowJobs = async ({ fetch: fetchImplementation = fetch, github, token }) => {
  const repository = github.repository;
  const runId = github.run_id;
  if (!repository || !runId || !token) {
    return;
  }
  const [owner, repo] = repository.split("/", 2);
  if (!owner || !repo) {
    return;
  }
  const jobs = [];
  for (let page = 1;page <= 10; page++) {
    const baseUrl = github.api_url || "https://api.github.com";
    const endpointPath = github.run_attempt ? `/repos/${owner}/${repo}/actions/runs/${runId}/attempts/${github.run_attempt}/jobs` : `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    const url = new URL(endpointPath, baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const response = await fetchImplementation(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Jaidlab/action-run-typescript",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const pageJobs = [...payload.jobs || []];
    jobs.push(...pageJobs);
    if (pageJobs.length < 100) {
      break;
    }
  }
  return jobs;
};
var resolveCurrentWorkflowJob = (jobs, { github, runnerName }) => {
  if (jobs.length === 1) {
    return jobs[0];
  }
  const jobName = github.job;
  if (jobName) {
    const nameMatches = jobs.filter((job) => job.name === jobName);
    if (nameMatches.length === 1) {
      return nameMatches[0];
    }
    if (nameMatches.length > 1 && runnerName) {
      const namedRunnerMatches = nameMatches.filter((job) => job.runner_name === runnerName);
      if (namedRunnerMatches.length === 1) {
        return namedRunnerMatches[0];
      }
      const namedRunningRunnerMatches = namedRunnerMatches.filter((job) => job.status === "in_progress");
      if (namedRunningRunnerMatches.length === 1) {
        return namedRunningRunnerMatches[0];
      }
    }
  }
  if (runnerName) {
    const runningRunnerMatches = jobs.filter((job) => job.runner_name === runnerName && job.status === "in_progress");
    if (runningRunnerMatches.length === 1) {
      return runningRunnerMatches[0];
    }
  }
  const runningJobs = jobs.filter((job) => job.status === "in_progress");
  if (runningJobs.length === 1) {
    return runningJobs[0];
  }
  if (runnerName) {
    const runnerMatches = jobs.filter((job) => job.runner_name === runnerName);
    if (runnerMatches.length === 1) {
      return runnerMatches[0];
    }
  }
};
var getCurrentWorkflowJob = async (options) => {
  const jobs = await listWorkflowJobs(options);
  if (!jobs?.length) {
    return;
  }
  return resolveCurrentWorkflowJob(jobs, options);
};

// src/lib/github/toWorkflowStepsFallback.ts
var pushGroupedStep = (record, key, step) => {
  const list = record[key];
  if (list) {
    list.push(step);
    return;
  }
  record[key] = [step];
};
var startsWithDigit = (value) => {
  const firstCharacter = value.slice(0, 1);
  return firstCharacter >= "0" && firstCharacter <= "9";
};
var toSlug = (value, fallback = "step") => {
  const slug = value.toLowerCase().replaceAll(/[^0-9a-z]+/g, "_").replaceAll(/^_+|_+$/g, "");
  if (!slug) {
    return fallback;
  }
  if (startsWithDigit(slug)) {
    return `step_${slug}`;
  }
  return slug;
};
var toWorkflowStepsFallback = (workflowJob) => {
  const stepsSource = workflowJob.steps ?? [];
  const steps = [...stepsSource];
  const byName = {};
  const byNumber = {};
  const bySlug = {};
  for (const step of steps) {
    if (step.number !== undefined && step.number !== null) {
      byNumber[String(step.number)] = step;
    }
    if (step.name) {
      pushGroupedStep(byName, step.name, step);
      const slug = toSlug(step.name, step.number === undefined || step.number === null ? "step" : `step_${step.number}`);
      pushGroupedStep(bySlug, slug, step);
      continue;
    }
    const fallbackSlug = toSlug(step.number === undefined || step.number === null ? "step" : String(step.number));
    pushGroupedStep(bySlug, fallbackSlug, step);
  }
  return {
    $source: "github-job-api",
    $job: {
      conclusion: workflowJob.conclusion ?? null,
      id: workflowJob.id ?? null,
      name: workflowJob.name ?? null,
      status: workflowJob.status ?? null,
      url: workflowJob.html_url ?? workflowJob.url ?? null
    },
    $list: steps,
    $byNumber: byNumber,
    $byName: byName,
    $bySlug: bySlug
  };
};

// src/lib/node/NodeModuleRunner.ts
import { spawn } from "node:child_process";
import path from "node:path";

// src/lib/node/internalEnvironment.ts
var ACTION_RUN_TYPESCRIPT_INTERNAL_MODE = "ACTION_RUN_TYPESCRIPT_INTERNAL_MODE";
var ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS = "ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS";
var ACTION_RUN_TYPESCRIPT_INTERNAL_CODE = "ACTION_RUN_TYPESCRIPT_INTERNAL_CODE";
var internalEnvironmentNames = [
  ACTION_RUN_TYPESCRIPT_INTERNAL_MODE,
  ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS,
  ACTION_RUN_TYPESCRIPT_INTERNAL_CODE
];

// src/lib/node/NodeModuleRunner.ts
var createSpawnEnvironment = (environment) => Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined));

class NodeModuleRunner {
  options;
  constructor(options) {
    this.options = options;
  }
  async run() {
    const child = spawn(process.execPath, [
      "--disable-warning=ExperimentalWarning",
      "--experimental-vm-modules",
      path.resolve(this.options.actionPath)
    ], {
      cwd: this.options.workspace,
      env: createSpawnEnvironment({
        ...this.options.environment,
        [ACTION_RUN_TYPESCRIPT_INTERNAL_MODE]: "1",
        [ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS]: JSON.stringify(this.options.bindings),
        [ACTION_RUN_TYPESCRIPT_INTERNAL_CODE]: this.options.code
      }),
      stdio: "inherit"
    });
    const { exitCode, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (closedExitCode, closedSignal) => {
        resolve({
          exitCode: closedExitCode,
          signal: closedSignal
        });
      });
    });
    if (signal) {
      throw new Error(`Inline TypeScript exited due to signal ${signal}.`);
    }
    const normalizedExitCode = exitCode ?? 0;
    if (normalizedExitCode !== 0) {
      throw new Error(`Inline TypeScript exited with code ${normalizedExitCode}.`);
    }
  }
}

// src/lib/parseJsonString.ts
var parseJsonString = (rawValue, name = "JSON value") => {
  if (rawValue === undefined || rawValue === "") {
    return;
  }
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`Failed to parse ${name}.`, { cause: error });
  }
};

// src/lib/toForwardSlashPath.ts
var toForwardSlashPath = (value) => value.replaceAll("\\", "/");

// src/lib/ActionRuntime.ts
var unresolvedExpressionPattern = /^\s*\$\{\{[\s\S]*\}\}\s*$/;

class ActionRuntime {
  environment;
  workspace;
  constructor(environment) {
    this.environment = environment;
    this.workspace = toForwardSlashPath(path2.resolve(environment.GITHUB_WORKSPACE || process.cwd()));
  }
  getActionPath() {
    const actionPath = this.getEnvironmentValue("ACTION_RUN_TYPESCRIPT_ACTION_PATH");
    if (!actionPath) {
      throw new Error("Missing internal action entry path.");
    }
    return path2.resolve(actionPath);
  }
  getBindings(workflowJob) {
    return {
      github: this.getGithubContext(),
      job: this.getContext("ACTION_RUN_TYPESCRIPT_JOB_CONTEXT", "INPUT_JOB_CONTEXT") || {},
      runner: this.getContext("ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT", "INPUT_RUNNER_CONTEXT") || this.getRunnerContextFromEnvironment(),
      strategy: this.getContext("ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT", "INPUT_STRATEGY_CONTEXT") || {},
      matrix: this.getContext("ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT", "INPUT_MATRIX_CONTEXT") || {},
      steps: this.getStepsContext(workflowJob),
      workflowJob: workflowJob || null
    };
  }
  getCode() {
    const code = this.getEnvironmentValue("ACTION_RUN_TYPESCRIPT_CODE", "INPUT_CODE");
    if (code === undefined) {
      throw new Error('Missing action input "code".');
    }
    return code;
  }
  getContext(...names) {
    for (const name of names) {
      const rawValue = this.getEnvironmentValue(name);
      if (rawValue === undefined) {
        continue;
      }
      return parseJsonString(rawValue, name);
    }
  }
  getEnvironmentValue(...names) {
    for (const name of names) {
      const value = this.environment[name];
      if (value === undefined || value === "") {
        continue;
      }
      if (unresolvedExpressionPattern.test(value)) {
        continue;
      }
      return value;
    }
  }
  getExecutionEnvironment(token = this.getGitHubToken()) {
    const executionEnvironment = {
      ...process.env,
      ...this.environment
    };
    for (const name of [
      "ACTION_RUN_TYPESCRIPT_ACTION_PATH",
      "ACTION_RUN_TYPESCRIPT_CODE",
      "ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN",
      "ACTION_RUN_TYPESCRIPT_JOB_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_MATRIX_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_RUNNER_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_STRATEGY_CONTEXT",
      "INPUT_CODE",
      "INPUT_GITHUB_CONTEXT",
      "INPUT_GITHUB_TOKEN",
      "INPUT_JOB_CONTEXT",
      "INPUT_MATRIX_CONTEXT",
      "INPUT_RUNNER_CONTEXT",
      "INPUT_STEPS",
      "INPUT_STRATEGY_CONTEXT",
      "ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS",
      "ACTION_RUN_TYPESCRIPT_INTERNAL_CODE",
      "ACTION_RUN_TYPESCRIPT_INTERNAL_MODE"
    ]) {
      delete executionEnvironment[name];
    }
    if (token && !executionEnvironment.GITHUB_TOKEN) {
      executionEnvironment.GITHUB_TOKEN = token;
    }
    return executionEnvironment;
  }
  getGithubContext() {
    return this.getContext("ACTION_RUN_TYPESCRIPT_GITHUB_CONTEXT", "INPUT_GITHUB_CONTEXT") || this.getGithubContextFromEnvironment();
  }
  getGithubContextFromEnvironment() {
    return {
      api_url: this.getEnvironmentValue("GITHUB_API_URL"),
      job: this.getEnvironmentValue("GITHUB_JOB"),
      repository: this.getEnvironmentValue("GITHUB_REPOSITORY"),
      run_attempt: this.getEnvironmentValue("GITHUB_RUN_ATTEMPT"),
      run_id: this.getEnvironmentValue("GITHUB_RUN_ID"),
      token: this.getEnvironmentValue("GITHUB_TOKEN")
    };
  }
  getGitHubToken() {
    return this.getEnvironmentValue("ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN", "INPUT_GITHUB_TOKEN", "GITHUB_TOKEN") || this.getGithubContext().token || undefined;
  }
  getRunnerContextFromEnvironment() {
    return {
      arch: this.getEnvironmentValue("RUNNER_ARCH"),
      name: this.getEnvironmentValue("RUNNER_NAME"),
      os: this.getEnvironmentValue("RUNNER_OS"),
      temp: this.getEnvironmentValue("RUNNER_TEMP"),
      tool_cache: this.getEnvironmentValue("RUNNER_TOOL_CACHE")
    };
  }
  getStepsContext(workflowJob) {
    const explicitStepsContext = this.getContext("ACTION_RUN_TYPESCRIPT_STEPS_CONTEXT", "INPUT_STEPS");
    if (explicitStepsContext !== undefined) {
      return explicitStepsContext;
    }
    if (workflowJob) {
      return toWorkflowStepsFallback(workflowJob);
    }
    return {};
  }
  async run() {
    const token = this.getGitHubToken();
    const workflowJob = await getCurrentWorkflowJob({
      github: this.getGithubContext(),
      token,
      runnerName: this.getEnvironmentValue("RUNNER_NAME")
    });
    const runner = new NodeModuleRunner({
      actionPath: this.getActionPath(),
      bindings: this.getBindings(workflowJob),
      code: this.getCode(),
      environment: this.getExecutionEnvironment(token),
      workspace: this.workspace
    });
    await runner.run();
  }
}

// src/lib/node/runInternalNodeAction.ts
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import path3 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

// src/lib/serializeCodeLiteral.ts
var serializeCodeLiteral = (value) => {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value, null, 2);
};

// src/lib/context/createCoreModuleSource.ts
var createCoreModuleSource = () => [
  "const getEnvironmentFile = (name: string) => {",
  "  const file = process.env[name]",
  "  if (!file) {",
  "    throw new Error(`Missing ${name}.`)",
  "  }",
  "  return file",
  "}",
  "",
  "const toCommandValue = (value: unknown) => {",
  "  if (value === undefined || value === null) {",
  "    return ''",
  "  }",
  "  if (typeof value === 'string') {",
  "    return value",
  "  }",
  "  const serialized = JSON.stringify(value)",
  "  return serialized === undefined ? '' : serialized",
  "}",
  "",
  String.raw`const escapeCommandValue = (value: unknown) => toCommandValue(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')`,
  "const escapeCommandProperty = (value: unknown) => escapeCommandValue(value).replaceAll(':', '%3A').replaceAll(',', '%2C')",
  "",
  "const toCommandPropertyString = (properties?: Record<string, unknown>) => {",
  "  if (!properties) {",
  "    return ''",
  "  }",
  "  const entries = Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== '')",
  "  if (!entries.length) {",
  "    return ''",
  "  }",
  "  return ' ' + entries.map(([key, value]) => `${key}=${escapeCommandProperty(value)}`).join(',')",
  "}",
  "",
  "const issueCommand = (command: string, message = '', properties?: Record<string, unknown>) => {",
  "  console.log(`::${command}${toCommandPropertyString(properties)}::${escapeCommandValue(message)}`)",
  "}",
  "",
  "const appendEnvironmentFileValue = (environmentFileName: string, name: string, value: unknown) => {",
  "  const stringValue = toCommandValue(value)",
  "  const delimiter = 'gha_delimiter_' + crypto.randomUUID()",
  String.raw`  const serializedLine = /[\r\n]/.test(stringValue)`,
  "    ? `${name}<<${delimiter}\\n${stringValue}\\n${delimiter}\\n`",
  "    : `${name}=${stringValue}\\n`",
  "  appendFileSync(getEnvironmentFile(environmentFileName), serializedLine, 'utf8')",
  "}",
  "",
  "const appendEnvironmentFileLine = (environmentFileName: string, value: unknown) => {",
  "  appendFileSync(getEnvironmentFile(environmentFileName), `${toCommandValue(value)}\\n`, 'utf8')",
  "}",
  "",
  "const summary = {",
  "  append(value: unknown) {",
  "    appendFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), toCommandValue(value), 'utf8')",
  "  },",
  "  clear() {",
  "    writeFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), '', 'utf8')",
  "  },",
  "  write(value: unknown) {",
  "    writeFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), toCommandValue(value), 'utf8')",
  "  },",
  "}",
  "",
  "export const core = {",
  "  addPath(inputPath: unknown) {",
  "    appendEnvironmentFileLine('GITHUB_PATH', inputPath)",
  "  },",
  "  debug(message: unknown) {",
  "    issueCommand('debug', message)",
  "  },",
  "  endGroup() {",
  "    issueCommand('endgroup')",
  "  },",
  "  error(message: unknown, properties?: Record<string, unknown>) {",
  "    issueCommand('error', message, properties)",
  "  },",
  "  exportVariable(name: string, value: unknown) {",
  "    appendEnvironmentFileValue('GITHUB_ENV', name, value)",
  "  },",
  "  getState(name: string) {",
  "    return process.env['STATE_' + name] || ''",
  "  },",
  "  async group<Value>(name: unknown, callback: () => Value | Promise<Value>) {",
  "    this.startGroup(name)",
  "    try {",
  "      return await callback()",
  "    } finally {",
  "      this.endGroup()",
  "    }",
  "  },",
  "  info(message: unknown) {",
  "    console.log(toCommandValue(message))",
  "  },",
  "  isDebug() {",
  "    return process.env.RUNNER_DEBUG === '1'",
  "  },",
  "  notice(message: unknown, properties?: Record<string, unknown>) {",
  "    issueCommand('notice', message, properties)",
  "  },",
  "  saveState(name: string, value: unknown) {",
  "    appendEnvironmentFileValue('GITHUB_STATE', name, value)",
  "  },",
  "  setFailed(message: unknown) {",
  "    const normalizedMessage = message instanceof Error ? message.stack || message.message : message",
  "    issueCommand('error', normalizedMessage)",
  "    process.exitCode = 1",
  "  },",
  "  setOutput(name: string, value: unknown) {",
  "    appendEnvironmentFileValue('GITHUB_OUTPUT', name, value)",
  "  },",
  "  setSecret(secret: unknown) {",
  "    issueCommand('add-mask', secret)",
  "  },",
  "  startGroup(name: unknown) {",
  "    issueCommand('group', name)",
  "  },",
  "  summary,",
  "  warning(message: unknown, properties?: Record<string, unknown>) {",
  "    issueCommand('warning', message, properties)",
  "  },",
  "}"
].join(`
`);

// src/lib/context/createContextModuleContent.ts
var createContextModuleContent = (bindings) => [
  "import {appendFileSync, writeFileSync} from 'node:fs'",
  "",
  createCoreModuleSource(),
  "",
  `export const github = ${serializeCodeLiteral(bindings.github)}`,
  `export const job = ${serializeCodeLiteral(bindings.job)}`,
  `export const runner = ${serializeCodeLiteral(bindings.runner)}`,
  `export const strategy = ${serializeCodeLiteral(bindings.strategy)}`,
  `export const matrix = ${serializeCodeLiteral(bindings.matrix)}`,
  `export const steps = ${serializeCodeLiteral(bindings.steps)}`,
  `export const workflowJob = ${serializeCodeLiteral(bindings.workflowJob)}`,
  ""
].join(`
`);

// src/lib/context/createScriptModuleContent.ts
var createScriptModuleContent = (contextModuleSpecifier, code) => [
  `import {core, github, job, matrix, runner, steps, strategy, workflowJob} from ${JSON.stringify(contextModuleSpecifier)}`,
  "",
  code,
  ""
].join(`
`);

// src/lib/node/runInternalNodeAction.ts
var { createRequire, isBuiltin } = nodeModule;
var supportedLocalExtensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".json"];
var supportedLocalExtensionList = supportedLocalExtensions.join(", ");
var unsupportedJsxExtensions = new Set([".tsx", ".jsx"]);
var contextModuleIdentifier = "action-run-typescript:context";
var getStripTypeScriptTypes = () => {
  const implementation = nodeModule.stripTypeScriptTypes;
  if (typeof implementation !== "function") {
    throw new TypeError("node:module.stripTypeScriptTypes is unavailable in this Node runtime.");
  }
  return implementation;
};
var isDirectory = (filePath) => {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
};
var isFile = (filePath) => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};
var isProbablyJsxFailure = (error, source, label) => {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.endsWith(".tsx") || normalizedLabel.endsWith(".jsx")) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unexpected token '<'") || message.includes("JSX") || source.includes("</") && message.includes("Unexpected token");
};
var isLocalFileSpecifier = (specifier) => specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:") || path3.isAbsolute(specifier);
var createJsxUnsupportedError = (label) => new Error(`TSX/JSX syntax is not supported by action-run-typescript runtime (${label}).`);
var createModuleSourceError = (phase, error, source, label) => {
  if (isProbablyJsxFailure(error, source, label)) {
    return createJsxUnsupportedError(label);
  }
  return new Error(`Failed to ${phase} module ${label}.`, { cause: error });
};
var createExecutionContext = () => {
  const sandbox = Object.create(null);
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === "crypto" || key === "global" || key === "globalThis" || key === "self") {
      continue;
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      Reflect.defineProperty(sandbox, key, descriptor);
    }
  }
  Reflect.defineProperty(sandbox, "global", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "globalThis", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "self", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "crypto", {
    configurable: true,
    enumerable: false,
    value: globalThis.crypto ?? webcrypto,
    writable: true
  });
  return vm.createContext(sandbox);
};
var getRequiredEnvironmentValue = (environment, name) => {
  const value = environment[name];
  if (value === undefined) {
    throw new Error(`Missing internal environment variable ${name}.`);
  }
  return value;
};
var stripInternalEnvironmentValues = (environment) => {
  for (const name of internalEnvironmentNames) {
    delete environment[name];
  }
};
var toFileIdentifierLabel = (identifier) => identifier.startsWith("file:") ? fileURLToPath(identifier) : identifier;
var transformTypeScriptSource = (source, label) => {
  try {
    return getStripTypeScriptTypes()(source, { mode: "transform" });
  } catch (error) {
    throw createModuleSourceError("transform", error, source, label);
  }
};

class NodeInlineModuleRuntime {
  bindings;
  context = createExecutionContext();
  linkModule = async (specifier, referencingModule) => {
    if (specifier === contextModuleIdentifier) {
      return this.getContextModule();
    }
    const parentIdentifier = referencingModule?.identifier || this.rootModuleIdentifier;
    if (isLocalFileSpecifier(specifier)) {
      return this.loadLocalModule(specifier, parentIdentifier);
    }
    return this.loadExternalModule(specifier, parentIdentifier);
  };
  moduleCache = new Map;
  pendingModuleCache = new Map;
  rootModuleIdentifier;
  workspace;
  constructor(bindings, workspace) {
    this.bindings = bindings;
    const normalizedWorkspace = path3.resolve(workspace);
    this.rootModuleIdentifier = pathToFileURL(path3.join(normalizedWorkspace, "__action_run_typescript_inline__.ts")).href;
    this.workspace = normalizedWorkspace;
  }
  createJsonModule(identifier) {
    const filePath = fileURLToPath(identifier);
    const rawJson = readFileSync(filePath, "utf8");
    let value;
    try {
      value = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`Failed to parse JSON module ${filePath}.`, { cause: error });
    }
    const module = new vm.SyntheticModule(["default"], () => {
      module.setExport("default", value);
    }, {
      context: this.context,
      identifier
    });
    return module;
  }
  createTextModule({ identifier, label, source, transformTypeScript }) {
    const compiledSource = transformTypeScript ? transformTypeScriptSource(source, label) : source;
    try {
      return new vm.SourceTextModule(compiledSource, {
        context: this.context,
        identifier,
        importModuleDynamically: (specifier, referencingModule) => this.importModuleDynamically(specifier, referencingModule),
        initializeImportMeta: (importMeta) => {
          importMeta.url = identifier;
          if (identifier.startsWith("file:")) {
            const filename = fileURLToPath(identifier);
            importMeta.dirname = path3.dirname(filename);
            importMeta.filename = filename;
          }
        }
      });
    } catch (error) {
      throw createModuleSourceError("compile", error, compiledSource, label);
    }
  }
  async ensureEvaluated(module) {
    if (module.status === "unlinked") {
      await this.ensureLinked(module);
    }
    if (module.status === "linked") {
      await module.evaluate();
    }
  }
  async ensureLinked(module) {
    if (module.status === "unlinked") {
      await module.link(this.linkModule);
    }
  }
  async evaluate(code) {
    const rootModule = await this.getOrCreateModule(this.rootModuleIdentifier, () => this.createTextModule({
      identifier: this.rootModuleIdentifier,
      label: "inline TypeScript",
      source: createScriptModuleContent(contextModuleIdentifier, code),
      transformTypeScript: true
    }));
    await this.ensureLinked(rootModule);
    await this.ensureEvaluated(rootModule);
  }
  async getContextModule() {
    return this.getOrCreateModule(contextModuleIdentifier, () => this.createTextModule({
      identifier: contextModuleIdentifier,
      label: "injected context module",
      source: createContextModuleContent(this.bindings),
      transformTypeScript: true
    }));
  }
  async getOrCreateModule(identifier, createModule) {
    const cachedModule = this.moduleCache.get(identifier);
    if (cachedModule) {
      return cachedModule;
    }
    const pendingModule = this.pendingModuleCache.get(identifier);
    if (pendingModule) {
      return pendingModule;
    }
    const createdModule = Promise.resolve(createModule()).then((module) => {
      this.moduleCache.set(identifier, module);
      return module;
    }).finally(() => {
      this.pendingModuleCache.delete(identifier);
    });
    this.pendingModuleCache.set(identifier, createdModule);
    return createdModule;
  }
  async importModuleDynamically(specifier, referencingModule) {
    const linkedModule = await this.linkModule(specifier, referencingModule);
    await this.ensureLinked(linkedModule);
    await this.ensureEvaluated(linkedModule);
    return linkedModule;
  }
  async loadExternalModule(specifier, parentIdentifier) {
    const resolvedSpecifier = this.resolveExternalModuleSpecifier(specifier, parentIdentifier);
    return this.getOrCreateModule(`external:${resolvedSpecifier}`, async () => {
      const namespace = await import(resolvedSpecifier);
      const exportNames = Object.getOwnPropertyNames(namespace);
      const module = new vm.SyntheticModule(exportNames, () => {
        for (const exportName of exportNames) {
          module.setExport(exportName, namespace[exportName]);
        }
      }, {
        context: this.context,
        identifier: resolvedSpecifier
      });
      return module;
    });
  }
  async loadLocalModule(specifier, parentIdentifier) {
    const resolvedPath = this.resolveLocalModulePath(specifier, parentIdentifier);
    const identifier = pathToFileURL(resolvedPath).href;
    return this.getOrCreateModule(identifier, () => {
      const extension = path3.extname(resolvedPath).toLowerCase();
      if (extension === ".json") {
        return this.createJsonModule(identifier);
      }
      if (unsupportedJsxExtensions.has(extension)) {
        throw createJsxUnsupportedError(resolvedPath);
      }
      const source = readFileSync(resolvedPath, "utf8");
      return this.createTextModule({
        identifier,
        label: resolvedPath,
        source,
        transformTypeScript: extension === ".ts" || extension === ".mts" || extension === ".cts"
      });
    });
  }
  resolveDirectoryIndexPath(directoryPath, specifier, parentIdentifier) {
    for (const extension of supportedLocalExtensions) {
      const indexFilePath = path3.join(directoryPath, `index${extension}`);
      if (isFile(indexFilePath)) {
        return path3.resolve(indexFilePath);
      }
    }
    for (const extension of unsupportedJsxExtensions) {
      const jsxIndexFilePath = path3.join(directoryPath, `index${extension}`);
      if (isFile(jsxIndexFilePath)) {
        throw createJsxUnsupportedError(jsxIndexFilePath);
      }
    }
    throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}. Supported extensions: ${supportedLocalExtensionList}.`);
  }
  resolveExternalModuleSpecifier(specifier, parentIdentifier) {
    if (specifier.startsWith("node:")) {
      return specifier;
    }
    if (isBuiltin(specifier)) {
      return `node:${specifier}`;
    }
    const requireParentPath = parentIdentifier.startsWith("file:") ? fileURLToPath(parentIdentifier) : path3.join(this.workspace, "__action_run_typescript_require__.mjs");
    try {
      const resolvedSpecifier = createRequire(requireParentPath).resolve(specifier);
      return resolvedSpecifier.startsWith("node:") ? resolvedSpecifier : pathToFileURL(resolvedSpecifier).href;
    } catch (error) {
      throw new Error(`Cannot resolve package import ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}.`, { cause: error });
    }
  }
  resolveLocalModulePath(specifier, parentIdentifier) {
    const parentDirectory = parentIdentifier.startsWith("file:") ? path3.dirname(fileURLToPath(parentIdentifier)) : this.workspace;
    const candidatePath = specifier.startsWith("file:") ? fileURLToPath(specifier) : path3.resolve(parentDirectory, specifier);
    const explicitExtension = path3.extname(candidatePath).toLowerCase();
    if (unsupportedJsxExtensions.has(explicitExtension)) {
      throw createJsxUnsupportedError(candidatePath);
    }
    if (explicitExtension) {
      if (isFile(candidatePath)) {
        return path3.resolve(candidatePath);
      }
      if (isDirectory(candidatePath)) {
        return this.resolveDirectoryIndexPath(candidatePath, specifier, parentIdentifier);
      }
      throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}.`);
    }
    for (const extension of supportedLocalExtensions) {
      const resolvedFilePath = `${candidatePath}${extension}`;
      if (isFile(resolvedFilePath)) {
        return path3.resolve(resolvedFilePath);
      }
    }
    for (const extension of unsupportedJsxExtensions) {
      const jsxFilePath = `${candidatePath}${extension}`;
      if (existsSync(jsxFilePath)) {
        throw createJsxUnsupportedError(jsxFilePath);
      }
    }
    if (isDirectory(candidatePath)) {
      return this.resolveDirectoryIndexPath(candidatePath, specifier, parentIdentifier);
    }
    throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}. Supported extensions: ${supportedLocalExtensionList}.`);
  }
}
var isInternalNodeActionEnvironment = (environment) => environment[ACTION_RUN_TYPESCRIPT_INTERNAL_MODE] === "1";
var runInternalNodeAction = async (environment = process.env) => {
  const code = getRequiredEnvironmentValue(environment, ACTION_RUN_TYPESCRIPT_INTERNAL_CODE);
  const bindings = parseJsonString(getRequiredEnvironmentValue(environment, ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS), ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS);
  if (bindings === undefined) {
    throw new Error(`Missing internal environment variable ${ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS}.`);
  }
  stripInternalEnvironmentValues(process.env);
  if (environment !== process.env) {
    stripInternalEnvironmentValues(environment);
  }
  const runtime = new NodeInlineModuleRuntime(bindings, process.cwd());
  await runtime.evaluate(code);
};

// src/main.ts
var actionEntryPath = import.meta.filename;
var createActionRuntimeEnvironment = (environment) => {
  if (environment.ACTION_RUN_TYPESCRIPT_ACTION_PATH) {
    return environment;
  }
  return {
    ...environment,
    ACTION_RUN_TYPESCRIPT_ACTION_PATH: actionEntryPath
  };
};
var isMainModule = () => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return path4.resolve(entryPath) === actionEntryPath;
};
var runAction = async (environment = process.env) => {
  if (isInternalNodeActionEnvironment(environment)) {
    await runInternalNodeAction(environment);
    return;
  }
  const runtime = new ActionRuntime(createActionRuntimeEnvironment(environment));
  await runtime.run();
};
var main_default = runAction;
if (isMainModule()) {
  await runAction();
}
export {
  main_default as default
};
