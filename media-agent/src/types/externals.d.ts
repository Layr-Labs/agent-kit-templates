// Optional dependency — only available when installed and Chrome is running
declare module 'browser-autopilot' {
  export class CDPBrowser {
    connect(url?: string): Promise<void>
    disconnect(): Promise<void>
    navigate(url: string): Promise<void>
    waitMs(ms: number): Promise<void>
    currentUrl(): Promise<string>
    evaluate<T = unknown>(expression: string): Promise<T>
    pasteContent(filePath: string, targetSelector?: string): Promise<string>
  }

  export interface Credentials {
    username: string
    password: string
    email: string
    totpKey: string
  }

  export interface OrchestratorOptions {
    credentials: Credentials
    loginUrl: string
    successUrlContains: string
    task: string
    model?: string
    maxSteps?: number
    extraTools?: Record<string, any>
    loginPrompt?: string
    keepBrowser?: boolean
  }

  export interface OrchestratorResult {
    result: string | null
    success: boolean
    loginMethod: 'cached' | 'cdp' | 'x11' | 'failed'
    browser?: CDPBrowser
  }

  export interface AgentModeSwitchRequest {
    mode: 'x11'
    reason: string
  }

  export interface AgentRunResult {
    result: string | null
    success: boolean
    history: unknown
    requestedModeSwitch: AgentModeSwitchRequest | null
  }

  export function runAgent(opts: {
    task: string
    browser: any
    model?: string
    extraTools?: Record<string, any>
    maxSteps?: number
    sensitiveData?: Record<string, string>
  }): Promise<AgentRunResult>

  export function orchestrate(opts: OrchestratorOptions): Promise<OrchestratorResult>

  export function createBrowserTools(browser: CDPBrowser): Record<string, any>
}
