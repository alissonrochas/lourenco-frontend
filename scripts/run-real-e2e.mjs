import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  realpathSync,
  openSync,
  closeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { waitForPort, stop } from '../e2e/environment.mjs'

const frontend = resolve(fileURLToPath(new URL('../', import.meta.url)))
const backend = realpathSync(process.env.E2E_BACKEND_PATH ?? join(frontend, '../backend'))
assert.equal(
  JSON.parse(readFileSync(join(backend, 'package.json'))).dependencies['@adonisjs/core'] !==
    undefined,
  true,
)
assert.ok(
  existsSync(join(backend, 'node_modules/@adonisjs/core')) &&
    existsSync(join(frontend, 'node_modules/@playwright/test')),
  'Instale as dependências dos dois projetos antes de executar.',
)
const root = mkdtempSync(join(tmpdir(), 'lourenco-real-e2e-'))
const logFile = join(root, 'servers.log')
const log = openSync(logFile, 'a')
const fingerprint = () =>
  Object.fromEntries(
    [frontend, backend]
      .flatMap((base) =>
        [
          '.env',
          '.env.local',
          '.env.development',
          '.env.test',
          '.env.production',
          'tmp/db.sqlite3',
          'tmp/db.sqlite3-wal',
          'tmp/db.sqlite3-shm',
          'package-lock.json',
          'types/better_sqlite3.d.ts',
        ].map((name) => [base, name]),
      )
      .map(([base, name]) => [
        basename(base) + '/' + name,
        existsSync(join(base, name))
          ? createHash('sha256')
              .update(readFileSync(join(base, name)))
              .digest('hex')
          : null,
      ]),
  )
const before = fingerprint()
const ignored = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  'tmp',
  'playwright-report',
  'test-results',
])
function copy(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter: (file) =>
      !ignored.has(basename(file)) && !basename(file).startsWith('.env') && !file.endsWith('.log'),
  })
  symlinkSync(join(source, 'node_modules'), join(destination, 'node_modules'), 'dir')
  mkdirSync(join(destination, 'tmp'), { recursive: true })
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}
const portableEnv = Object.fromEntries(
  ['PATH', 'HOME', 'LANG', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]),
)
let front, tests
const terminate = () => {
  void stop(tests, true)
  void stop(front, true)
}
process.once('SIGINT', terminate)
process.once('SIGTERM', terminate)
try {
  const backendRoot = join(root, 'backend'),
    frontendRoot = join(root, 'frontend')
  copy(backend, backendRoot)
  copy(frontend, frontendRoot)
  mkdirSync(join(backendRoot, 'commands'), { recursive: true })
  writeFileSync(
    join(backendRoot, 'commands/real_e2e_fixture.ts'),
    readFileSync(join(frontend, 'e2e/backend-fixture.stub')),
  )
  const backendPort = await freePort()
  let frontendPort = await freePort()
  while (frontendPort === backendPort) frontendPort = await freePort()
  const backendURL = `http://127.0.0.1:${backendPort}`,
    frontendURL = `http://127.0.0.1:${frontendPort}`
  const token = randomBytes(24).toString('hex')
  const backendEnv = {
    ...portableEnv,
    NODE_ENV: 'development',
    TZ: 'UTC',
    HOST: '127.0.0.1',
    PORT: String(backendPort),
    LOG_LEVEL: 'error',
    APP_KEY: randomBytes(24).toString('base64'),
    APP_URL: backendURL,
    SESSION_DRIVER: 'database',
    CORS_ALLOWED_ORIGINS: frontendURL,
    TRUST_PROXY: 'loopback',
    E2E_BACKEND_ROOT: backendRoot,
    E2E_TOKEN: token,
  }
  const contextFile = join(root, 'context.json')
  writeFileSync(
    contextFile,
    JSON.stringify({
      root,
      token,
      backendRoot,
      frontendRoot,
      backendURL,
      frontendURL,
      database: join(backendRoot, 'tmp/db.sqlite3'),
      backendEnv,
    }),
  )
  const env = {
    ...portableEnv,
    E2E_CONTEXT: contextFile,
    E2E_TOKEN: token,
    ...(process.env.E2E_BROWSER_CHANNEL
      ? { E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL }
      : {}),
  }
  front = spawn(
    process.execPath,
    [
      join(frontend, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(frontendPort),
      '--strictPort',
    ],
    {
      cwd: frontendRoot,
      env: { ...portableEnv, NODE_ENV: 'development', VITE_API_URL: backendURL },
      detached: true,
      stdio: ['ignore', log, log],
    },
  )
  await waitForPort(frontendURL, front)
  console.log(
    'Aplicações reais em cópias descartáveis; portas dinâmicas; nenhum .env original carregado.',
  )
  tests = spawn(
    process.execPath,
    [join(frontend, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)],
    { cwd: frontend, env, detached: true, stdio: 'inherit' },
  )
  const code = await new Promise((resolvePromise, reject) => {
    tests.once('error', reject)
    tests.once('exit', (value) => resolvePromise(value ?? 1))
  })
  process.exitCode = code
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await stop(tests, true)
  await stop(front, true)
  closeSync(log)
  mkdirSync(join(frontend, 'test-results'), { recursive: true })
  if (process.exitCode) cpSync(logFile, join(frontend, 'test-results/servers.log'))
  const after = fingerprint()
  const preserved = JSON.stringify(before) === JSON.stringify(after)
  writeFileSync(
    join(frontend, 'test-results/preservation.json'),
    JSON.stringify({ preserved, before, after }, null, 2),
  )
  // Record checked-out revisions, never environment values or test keys.
  const revisions = Object.fromEntries(
    [
      ['frontend', frontend],
      ['backend', backend],
    ].map(([name, cwd]) => [
      name,
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
    ]),
  )
  writeFileSync(join(frontend, 'test-results/revisions.json'), JSON.stringify(revisions, null, 2))
  rmSync(root, { recursive: true, force: true })
  if (!preserved) {
    console.error(
      'Um arquivo original mudou durante a execução. Consulte preservation.json; nada foi restaurado ou sobrescrito.',
    )
    process.exitCode = 1
  }
  console.log(
    `Banco, cópias e processos descartáveis removidos; arquivos originais preservados: ${preserved}.`,
  )
}
