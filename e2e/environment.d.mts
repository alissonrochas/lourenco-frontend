import type { ChildProcess } from 'node:child_process'
export type FixtureInfo = {
  date: string
  closedDate: string
  to: string
  adminId: number
  serviceId: number
  startedId?: number
  startedDate?: string
}
export type IntegrationContext = {
  root: string
  token: string
  backendRoot: string
  frontendRoot: string
  backendURL: string
  frontendURL: string
  database: string
  backendEnv: NodeJS.ProcessEnv
}
export function integrationContext(): IntegrationContext
export function fixture(mode?: string): Promise<FixtureInfo>
export function rows(sql: string, bindings?: unknown[]): Record<string, unknown>[]
export function command(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string>
export function waitForPort(url: string, child: ChildProcess): Promise<void>
export function stop(child: ChildProcess | undefined, group?: boolean): Promise<void>
