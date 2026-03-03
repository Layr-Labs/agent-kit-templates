// Optional dependency — only available when installed and Chrome is running
declare module 'browser-autopilot' {
  export class CDPBrowser {
    connect(url?: string): Promise<void>
  }

  export function runAgent(opts: {
    task: string
    browser: any
    extraTools?: Record<string, any>
    maxSteps?: number
    sensitiveData?: Record<string, string>
  }): Promise<{ result: string | null; success: boolean }>

  export function createBrowserTools(browser: CDPBrowser): Record<string, any>
}
