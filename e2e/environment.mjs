import assert from 'node:assert/strict'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import net from 'node:net'

export function integrationContext() {
  assert.ok(
    process.env.E2E_CONTEXT,
    'Execute npm run test:e2e; não inicie Playwright contra um servidor externo.',
  )
  const context = JSON.parse(readFileSync(process.env.E2E_CONTEXT, 'utf8'))
  assert.equal(dirname(resolve(process.env.E2E_CONTEXT)), context.root)
  assert.ok(basename(context.root).startsWith('lourenco-real-e2e-'))
  assert.equal(context.token, process.env.E2E_TOKEN)
  assert.equal(context.backendRoot, join(context.root, 'backend'))
  assert.equal(context.frontendRoot, join(context.root, 'frontend'))
  assert.equal(realpathSync(context.backendRoot), context.backendRoot)
  assert.equal(context.database, join(context.backendRoot, 'tmp/db.sqlite3'))
  for (const value of [context.backendURL, context.frontendURL]) {
    const url = new URL(value)
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.protocol, 'http:')
    assert.ok(Number(url.port) > 0)
  }
  return context
}
export async function command(args, cwd, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    child.stderr.on('data', (data) => {
      output += data.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`Comando falhou (${code}): ${args.join(' ')}\n${output}`)),
    )
  })
}
export async function fixture(mode = 'base') {
  const c = integrationContext()
  await command(['ace.js', 'real:e2e-fixture'], c.backendRoot, {
    ...c.backendEnv,
    E2E_FIXTURE_MODE: mode,
  })
  return JSON.parse(readFileSync(join(c.root, 'fixture.json'), 'utf8'))
}
export function rows(sql, bindings = []) {
  const c = integrationContext()
  assert.ok(existsSync(c.database))
  assert.equal(realpathSync(c.database), c.database)
  const require = createRequire(join(c.backendRoot, 'package.json'))
  const Sqlite = require('better-sqlite3')
  const db = new Sqlite(c.database, { readonly: true, fileMustExist: true })
  try {
    return db.prepare(sql).all(...bindings)
  } finally {
    db.close()
  }
}
export async function waitForPort(url, child) {
  const target = new URL(url)
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Servidor encerrou antes de iniciar.')
    const ready = await new Promise((resolvePromise) => {
      const socket = net.connect(Number(target.port), target.hostname)
      socket.once('connect', () => {
        socket.destroy()
        resolvePromise(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolvePromise(false)
      })
      socket.setTimeout(200, () => {
        socket.destroy()
        resolvePromise(false)
      })
    })
    if (ready) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Tempo excedido aguardando servidor local.')
}
export async function stop(child, group = false) {
  if (!child?.pid) return
  try {
    if (group) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (group) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
