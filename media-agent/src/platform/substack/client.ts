import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { EventBus } from '../../console/events.js'
import type { BrowserLike } from '../../browser/types.js'

export interface SubstackArticle {
  slug: string
  url: string
}

export interface SubstackNote {
  id: string
  url: string
}

export interface SubstackComment {
  id: string
  author: string
  text: string
  postSlug: string
  createdAt: string
}

export class SubstackClient {
  public handle: string

  constructor(
    private events: EventBus,
    handle: string,
    private browser: BrowserLike,
  ) {
    this.handle = handle
  }

  get baseUrl(): string {
    return `https://${this.handle}.substack.com`
  }

  private lastLoginSuccess = 0

  /**
   * Check if we're logged into Substack.
   * Cached for 30 minutes after a successful login — no check needed.
   * Otherwise navigates to the dashboard and checks if it loaded or redirected to sign-in.
   */
  async isLoggedIn(): Promise<boolean> {
    if (Date.now() - this.lastLoginSuccess < 30 * 60 * 1000) return true

    const browser = this.browser
    try {
      await browser.navigate(`${this.baseUrl}/publish/home`)
      await browser.waitMs(3000)
      const url = await browser.currentUrl()
      const loggedIn = !url.includes('/sign-in') && !url.includes('/login')
      if (loggedIn) this.lastLoginSuccess = Date.now()
      return loggedIn
    } catch {
      return false
    }
  }

  /**
   * Log into Substack using email verification via EigenMail.
   * Returns true if login succeeded.
   */
  async login(): Promise<boolean> {
    this.events.monologue('Logging into Substack...')

    const { runBrowserTask } = await import('../../browser/index.js')

    // Derive email from mnemonic
    const mnemonic = process.env.MNEMONIC
    if (!mnemonic) {
      this.events.monologue('No MNEMONIC set — cannot derive email for login')
      return false
    }

    let mailClient: any = null
    try {
      const { mnemonicToSeedSync } = await import('bip39')
      const { HDKey } = await import('viem/accounts')
      const seed = mnemonicToSeedSync(mnemonic)
      const hd = HDKey.fromMasterSeed(seed)
      const derived = hd.derive("m/44'/60'/0'/0/0")
      const privateKey = `0x${Buffer.from(derived.privateKey!).toString('hex')}` as `0x${string}`

      const { EigenMailClient } = await import('eigenmail-sdk')
      mailClient = new EigenMailClient({
        privateKey,
        apiUrl: process.env.EIGENMAIL_API_URL ?? 'https://api.eigenagents.org',
      })
      await mailClient.login()
    } catch (err) {
      this.events.monologue(`Email client init failed: ${(err as Error).message}`)
      return false
    }

    const { tool } = await import('ai')
    const { z } = await import('zod')

    let agentEmail = 'unknown@eigenagents.org'
    try {
      const me = await mailClient.me()
      agentEmail = me.email
    } catch {}
    this.events.monologue(`Login email: ${agentEmail}`)

    // Email tools for the browser agent
    const extraTools: Record<string, any> = {
      wait_for_email: tool({
        description: 'Wait for a verification email from Substack. Call after submitting your email on the sign-in page.',
        inputSchema: z.object({
          from: z.string().optional().default('substack.com'),
          timeout_seconds: z.number().default(120),
        }),
        execute: async ({ from, timeout_seconds }: any) => {
          try {
            const msg = await mailClient.waitForEmail({
              from,
              timeout: Math.max(timeout_seconds * 1000, 30_000),
              interval: 5_000,
            })
            if (!msg) return 'Timed out — no email arrived.'
            const urls = ((msg.body as string).match(/https?:\/\/[^\s"<>\]]+/g) ?? [])
              .filter((u: string) => !u.includes('/open?') && !u.includes('/o/'))
            return JSON.stringify({ subject: msg.subject, from: msg.from, urls, hint: 'Look for a magic link or 6-digit code.' }, null, 2)
          } catch (e: any) { return `Error: ${e.message}` }
        },
      }),
      read_inbox: tool({
        description: 'List recent emails in the inbox.',
        inputSchema: z.object({ limit: z.number().default(5) }),
        execute: async ({ limit }: any) => {
          try {
            const { messages } = await mailClient.inbox({ limit })
            return JSON.stringify(messages.map((m: any) => ({ id: m.id, subject: m.subject, from: m.from, date: m.date })), null, 2)
          } catch (e: any) { return `Error: ${e.message}` }
        },
      }),
    }

    const result = await runBrowserTask({
      task: `Log into Substack.

TOOLS: You have wait_for_email and read_inbox tools. Use these for email — do NOT navigate to any email website.

STEPS:
1. First call read_inbox to check if a Substack magic link email already exists
2. Navigate to https://substack.com/sign-in
3. Enter email: ${agentEmail}
4. Click continue — this sends a magic link email
5. Call wait_for_email with from="substack.com" and timeout_seconds=120
6. The result contains URLs — find the magic link and navigate to it
7. If wait_for_email times out, call read_inbox to check. Do NOT re-submit the form.
8. Return "logged_in" if successful

CRITICAL:
- Submit the sign-in form ONLY ONCE. Never re-enter the email or click continue again.
- If you see "Too many login emails", return "login_failed: rate_limited" immediately.
- Do NOT search the filesystem for credentials.`,
      browser: this.browser,
      extraTools,
      maxSteps: 40,
    })

    const success = result.success && result.result?.toLowerCase().includes('logged_in')
    if (success) {
      this.events.monologue('Successfully logged into Substack')
      // Update account store
      const dataDir = join(process.cwd(), '.data')
      const accountPath = join(dataDir, 'substack-account.json')
      if (existsSync(accountPath)) {
        try {
          const account = JSON.parse(readFileSync(accountPath, 'utf-8'))
          account.loggedIn = true
          const { writeFileSync } = await import('fs')
          writeFileSync(accountPath, JSON.stringify(account, null, 2))
        } catch {}
      }
    } else {
      this.events.monologue(`Substack login failed: ${result.result?.slice(0, 100)}`)
    }
    return !!success
  }

  /**
   * Ensure we're logged in. Re-login if session expired.
   */
  private lastLoginAttempt = 0
  private loginBackoffMs = 0

  async ensureLoggedIn(): Promise<boolean> {
    if (await this.isLoggedIn()) return true

    const now = Date.now()
    if (this.loginBackoffMs > 0 && (now - this.lastLoginAttempt) < this.loginBackoffMs) {
      const waitMins = Math.round((this.loginBackoffMs - (now - this.lastLoginAttempt)) / 60000)
      this.events.monologue(`Substack login rate-limited. Waiting ${waitMins} more minutes before retrying.`)
      return false
    }

    this.events.monologue('Substack session expired — re-authenticating...')
    this.lastLoginAttempt = now
    const ok = await this.login()

    if (ok) {
      this.lastLoginSuccess = now
      this.loginBackoffMs = 0
    } else {
      this.loginBackoffMs = 30 * 60 * 1000
      this.events.monologue('Login failed. Backing off for 30 minutes to avoid rate limits.')
    }

    return ok
  }

  /**
   * Upload an image to Substack's CDN via their API.
   */
  async uploadImage(imagePath: string): Promise<{ url: string; width: number; height: number } | null> {
    const browser = this.browser
    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')

    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
    const mime = mimeMap[ext] ?? 'image/png'

    const CHUNK_SIZE = 500_000
    await browser.evaluate(`window.__imgB64 = ''`)
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      const chunk = base64.slice(i, i + CHUNK_SIZE)
      await browser.evaluate(`window.__imgB64 += ${JSON.stringify(chunk)}`)
    }

    const resultJson = await browser.evaluate<string>(`
      (async () => {
        const dataUrl = 'data:${mime};base64,' + window.__imgB64;
        delete window.__imgB64;
        try {
          const r = await fetch('/api/v1/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl }),
            credentials: 'include',
          });
          if (!r.ok) return JSON.stringify({ error: 'HTTP ' + r.status });
          const data = await r.json();
          return JSON.stringify({ url: data.url, width: data.imageWidth, height: data.imageHeight });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      })()
    `)

    try {
      const result = JSON.parse(resultJson)
      if (result.error) {
        this.events.monologue(`Image upload failed: ${result.error}`)
        return null
      }
      this.events.monologue(`Image uploaded to CDN: ${result.url}`)
      return result
    } catch {
      return null
    }
  }

  /**
   * Insert an uploaded image into Substack's Tiptap editor via ProseMirror transaction.
   */
  async insertEditorImage(cdnUrl: string, width: number, height: number): Promise<boolean> {
    const browser = this.browser
    const result = await browser.evaluate<string>(`
      (() => {
        const tiptapEl = document.querySelector('.tiptap');
        const editor = tiptapEl?.editor;
        if (!editor || !editor.view || !editor.schema) return 'no editor';
        const image2Type = editor.schema.nodes.image2;
        if (!image2Type) return 'no image2 node type';
        editor.commands.focus();
        const node = image2Type.create({
          src: ${JSON.stringify(cdnUrl)},
          width: ${width},
          height: ${height},
          alt: '',
        });
        editor.view.dispatch(editor.view.state.tr.insert(0, node));
        return 'ok';
      })()
    `)
    return result === 'ok'
  }

  async publishArticle(opts: {
    title: string
    body: string
    subtitle?: string
    headerImagePath?: string
  }): Promise<SubstackArticle> {
    this.events.monologue(`Publishing article: "${opts.title}" on Substack...`)

    // Ensure we're logged in before attempting anything
    const loggedIn = await this.ensureLoggedIn()
    if (!loggedIn) {
      throw new Error('Cannot publish — failed to log into Substack')
    }

    const { runBrowserTask } = await import('../../browser/index.js')
    const { writeFileSync, mkdirSync } = await import('fs')
    const { join } = await import('path')

    const articlesDir = join(process.cwd(), '.data', 'articles')
    mkdirSync(articlesDir, { recursive: true })
    const slug = opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const articlePath = join(articlesDir, `${slug}.md`)
    writeFileSync(articlePath, opts.body, 'utf-8')

    const browser = this.browser

    // Upload image and inject content directly (no LLM agent needed for this)
    let imageInserted = false
    if (opts.headerImagePath) {
      this.events.monologue('Uploading header image to Substack CDN...')
      await browser.navigate(`${this.baseUrl}/publish/post`)
      await browser.waitMs(5000)

      const uploaded = await this.uploadImage(opts.headerImagePath)
      if (uploaded) {
        await browser.pasteContent(articlePath)
        await browser.waitMs(1000)
        imageInserted = await this.insertEditorImage(uploaded.url, uploaded.width, uploaded.height)
        if (imageInserted) {
          this.events.monologue('Header image and article content injected into editor')
        }
      } else {
        // Image upload failed (possibly 401) — re-check login
        this.events.monologue('Image upload failed — checking login status...')
        const stillLoggedIn = await this.ensureLoggedIn()
        if (stillLoggedIn) {
          // Retry upload after re-login
          await browser.navigate(`${this.baseUrl}/publish/post`)
          await browser.waitMs(5000)
          const retryUpload = await this.uploadImage(opts.headerImagePath)
          if (retryUpload) {
            await browser.pasteContent(articlePath)
            await browser.waitMs(1000)
            imageInserted = await this.insertEditorImage(retryUpload.url, retryUpload.width, retryUpload.height)
          }
        }
      }
    }

    const imageNote = imageInserted
      ? 'The header image has ALREADY been inserted into the editor. Do NOT try to add another image. Just enter the title, paste the content, and publish.'
      : opts.headerImagePath
        ? `Upload the header image. Use paste_image({ file_path: "${opts.headerImagePath}" }) or click_and_upload if needed.`
        : ''

    const result = await runBrowserTask({
      task: `Publish an article on Substack.

${imageInserted ? 'The editor is already open with the header image inserted.' : `Navigate to ${this.baseUrl}/publish/post.`} You should already be logged in.

Article details:
- Title: "${opts.title}"
${opts.subtitle ? `- Subtitle: "${opts.subtitle}"` : ''}
- Full article body file: ${articlePath}
${imageNote}

**paste_content** — Injects a markdown/HTML file into the editor in one shot. Call: paste_content({ file_path: "${articlePath}" }). This is MUCH faster than typing.

Steps:
1. ${imageInserted ? 'The editor is open.' : 'Navigate to the post editor'}
2. Enter the title "${opts.title}"${opts.subtitle ? ` and subtitle "${opts.subtitle}"` : ''}
3. ${imageInserted ? 'Content is already injected.' : `Inject the article body — call paste_content with file_path="${articlePath}"`}
4. Verify the content looks correct (screenshot)
5. Click "Publish" and confirm
6. Return the published URL

IMPORTANT:
- Use paste_content for the article body — do NOT type it manually.
- ${imageInserted ? 'Do NOT add any images — the header image is already inserted.' : ''}
- If not logged in, STOP and return "NOT_LOGGED_IN".
- Do NOT search the filesystem for credentials.`,
      browser: this.browser,
      maxSteps: 100,
    })

    // Check if publishing actually succeeded
    if (!result.success || result.result?.includes('NOT_LOGGED_IN') || result.result?.includes('Not logged in')) {
      throw new Error(`Publishing failed: ${result.result?.slice(0, 200) ?? 'unknown error'}`)
    }

    const url = result.result?.match(/https:\/\/[^\s"]+/)?.[0] ?? `${this.baseUrl}/p/${slug}`

    this.events.monologue(`Article published at ${url}`)
    return { slug, url }
  }

  async publishNote(opts: {
    text: string
    imagePath?: string
  }): Promise<SubstackNote> {
    this.events.monologue('Publishing note on Substack...')

    const loggedIn = await this.ensureLoggedIn()
    if (!loggedIn) throw new Error('Cannot publish note — not logged in')

    const { runBrowserTask } = await import('../../browser/index.js')

    const result = await runBrowserTask({
      task: `Navigate to ${this.baseUrl}/notes. Create a new note with text: "${opts.text}"${opts.imagePath ? `. Upload image from ${opts.imagePath}` : ''}. Post it. If not logged in, return "NOT_LOGGED_IN". Do NOT search the filesystem for credentials.`,
      browser: this.browser,
      maxSteps: 60,
    })

    if (!result.success || result.result?.includes('NOT_LOGGED_IN')) {
      throw new Error(`Note publish failed: ${result.result?.slice(0, 200)}`)
    }

    return { id: Date.now().toString(), url: `${this.baseUrl}/notes` }
  }

  async getRecentComments(): Promise<SubstackComment[]> {
    const { runBrowserTask } = await import('../../browser/index.js')

    const result = await runBrowserTask({
      task: `Navigate to ${this.baseUrl}/dashboard/comments. Extract the most recent 10 comments. Return as JSON array. If not logged in, return empty array []. Do NOT search the filesystem for credentials.`,
      browser: this.browser,
      maxSteps: 50,
    })

    try {
      const match = result.result?.match(/\[[\s\S]*\]/)
      if (match) return JSON.parse(match[0])
    } catch {}
    return []
  }

  async replyToComment(commentId: string, text: string): Promise<void> {
    const { runBrowserTask } = await import('../../browser/index.js')

    await runBrowserTask({
      task: `Navigate to the comment "${commentId}". Reply with: "${text}". Submit. If not logged in, return "NOT_LOGGED_IN". Do NOT search the filesystem for credentials.`,
      browser: this.browser,
      maxSteps: 50,
    })

    this.events.monologue(`Replied to comment: "${text.slice(0, 50)}..."`)
  }
}
