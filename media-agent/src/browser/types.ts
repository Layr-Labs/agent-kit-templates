export interface BrowserLike {
  connect(url?: string): Promise<void>
  disconnect(): Promise<void>
  navigate(url: string): Promise<void>
  waitMs(ms: number): Promise<void>
  currentUrl(): Promise<string>
  evaluate<T = unknown>(expression: string): Promise<T>
  pasteContent(filePath: string, targetSelector?: string): Promise<string>
}

export interface BrowserTaskResult {
  result: string | null
  success: boolean
}

export interface BrowserLoginOptions {
  platform: string
  loginUrl: string
  successUrlContains: string
  credentials: {
    username: string
    password: string
    email?: string
    totpKey?: string
  }
  browser?: BrowserLike
  task?: string
  maxSteps?: number
}

export interface BrowserLoginResult extends BrowserTaskResult {
  browser: BrowserLike | null
  loginMethod: 'cached' | 'cdp' | 'x11' | 'failed'
}
