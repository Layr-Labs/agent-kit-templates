import { useEffect, useRef, useState, type ReactElement } from 'react'
import { EigenSymbol } from './eigen-symbol'
import type { ConsoleEvent, PublicPostRecord, SiteBootstrapPayload, TabId } from './types'

const TAB_ORDER: TabId[] = ['editorial', 'live', 'worldview', 'about']
const LOAD_MORE_LIMIT = 12

export default function App() {
  const [bootstrap, setBootstrap] = useState<SiteBootstrapPayload | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab)
  const [currentState, setCurrentState] = useState('scanning')
  const [recentEvents, setRecentEvents] = useState<ConsoleEvent[]>([])
  const [editorialPosts, setEditorialPosts] = useState<PublicPostRecord[]>([])
  const [editorialTotal, setEditorialTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const seenEventKeys = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    async function loadBootstrap() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/site/bootstrap')
        if (!response.ok) {
          throw new Error(`Bootstrap request failed (${response.status})`)
        }

        const payload = await response.json() as SiteBootstrapPayload
        if (cancelled) return

        setBootstrap(payload)
        setCurrentState(payload.live.state)
        setRecentEvents(payload.live.recentEvents)
        setEditorialPosts(payload.editorial.posts)
        setEditorialTotal(payload.editorial.total)
        seenEventKeys.current = new Set(payload.live.recentEvents.map(createEventKey))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load the agent dossier.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadBootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const syncFromHash = () => setActiveTab(getInitialTab())
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  useEffect(() => {
    if (!bootstrap) return

    const source = new EventSource('/api/console/stream')
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ConsoleEvent
        const key = createEventKey(event)
        if (seenEventKeys.current.has(key)) return
        seenEventKeys.current.add(key)

        if (event.type === 'state_change') {
          const nextState = typeof event.to === 'string' && event.to.length > 0
            ? event.to
            : 'scanning'
          setCurrentState(nextState)

          if (event.from === event.to) {
            return
          }
        }

        if (event.type === 'post') {
          setEditorialTotal((prev) => prev + 1)
        }

        setRecentEvents((prev) => [event, ...prev].slice(0, 40))
      } catch {
        // Ignore malformed stream data.
      }
    }

    return () => source.close()
  }, [bootstrap])

  useEffect(() => {
    if (!bootstrap) return
    document.title = `${bootstrap.identity.name} — Live dossier`
  }, [bootstrap])

  async function handleLoadMore() {
    if (loadingMore) return
    setLoadingMore(true)

    try {
      const response = await fetch(`/api/feed?limit=${LOAD_MORE_LIMIT}&offset=${editorialPosts.length}`)
      if (!response.ok) {
        throw new Error(`Feed request failed (${response.status})`)
      }

      const rows = await response.json() as Array<Record<string, unknown>>
      const nextPosts = rows.map(normalizePost)

      setEditorialPosts((prev) => {
        const existing = new Set(prev.map(post => post.id))
        return [...prev, ...nextPosts.filter(post => !existing.has(post.id))]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more posts.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      window.setTimeout(() => setCopiedValue((current) => current === value ? null : current), 1800)
    } catch {
      setCopiedValue(null)
    }
  }

  function activateTab(nextTab: TabId) {
    setActiveTab(nextTab)
    if (window.location.hash !== `#${nextTab}`) {
      window.history.replaceState(null, '', `#${nextTab}`)
    }
    document.getElementById('tab-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: TabId) {
    const currentIndex = TAB_ORDER.indexOf(tab)
    if (currentIndex === -1) return

    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_ORDER.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TAB_ORDER.length - 1

    if (nextIndex !== currentIndex) {
      event.preventDefault()
      activateTab(TAB_ORDER[nextIndex])
      const nextButton = document.querySelector<HTMLButtonElement>(`[data-tab="${TAB_ORDER[nextIndex]}"]`)
      nextButton?.focus()
    }
  }

  if (loading && !bootstrap) {
    return (
      <main className="shell loading-shell">
        <section className="loading-card">
          <p className="eyebrow">LIVE DOSSIER</p>
          <h1>Loading the agent&rsquo;s public record.</h1>
          <p>
            Pulling identity, worldview, field notes, published work, and public runtime metadata
            from the live instance.
          </p>
        </section>
      </main>
    )
  }

  if (!bootstrap) {
    return (
      <main className="shell loading-shell">
        <section className="loading-card error-card">
          <p className="eyebrow">LIVE DOSSIER</p>
          <h1>The dossier could not load.</h1>
          <p>{error ?? 'The runtime did not return a bootstrap payload.'}</p>
          <button className="button button-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    )
  }

  const activeTabConfig = bootstrap.copy.tabs.find((tab) => tab.id === activeTab) ?? bootstrap.copy.tabs[0]
  const hasMorePosts = editorialPosts.length < editorialTotal
  const stateLabel = formatStateLabel(currentState)
  const activeSkills = bootstrap.transparency.skills.active

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label={`${bootstrap.identity.name} live dossier`}>
          <span className="brand-symbol-wrap">
            <EigenSymbol className="brand-symbol" />
          </span>
          <div className="brand-copy">
            <span className="brand-name">{bootstrap.identity.name}</span>
            <span className="brand-subtitle">Agent dossier</span>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="state-pill">
            <span className="state-dot" aria-hidden="true" />
            {stateLabel}
          </span>
          <button className="button button-ghost" onClick={() => activateTab('editorial')}>
            {bootstrap.copy.secondaryCtaLabel}
          </button>
        </div>
      </header>

      <main className="page">
        <section className="hero card-dark">
          <div className="hero-copy">
            <p className="eyebrow eyebrow-light">{bootstrap.copy.eyebrow}</p>
            <h1 className="hero-title">{bootstrap.identity.tagline}</h1>
            <p className="hero-support">{bootstrap.copy.heroSupport}</p>

            <div className="hero-actions">
              <button className="button button-primary" onClick={() => activateTab('live')}>
                {bootstrap.copy.primaryCtaLabel}
              </button>
              <button className="button button-secondary" onClick={() => activateTab('editorial')}>
                {bootstrap.copy.secondaryCtaLabel}
              </button>
            </div>

            <dl className="hero-metrics">
              <Metric label="State" value={stateLabel} />
              <Metric label="Published" value={String(editorialTotal)} />
              <Metric label="Skills" value={String(activeSkills.length)} />
              <Metric label="Compiled" value={formatRelativeTime(bootstrap.meta.compiledAt)} />
            </dl>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-art-grid" />
            <div className="hero-columns">
              {Array.from({ length: 12 }).map((_, index) => (
                <span key={index} className={`hero-block hero-block-${(index % 6) + 1}`} />
              ))}
            </div>
            <div className="hero-emblem">
              <EigenSymbol className="hero-emblem-symbol" />
            </div>
            <p className="hero-motto">{bootstrap.identity.motto}</p>
          </div>
        </section>

        <section className="tab-root" id="tab-root">
          <div className="tab-header">
            <div>
              <p className="eyebrow">{bootstrap.identity.name}</p>
              <h2 className="section-title">{activeTabConfig.label}</h2>
            </div>
            <p className="tab-description">{activeTabConfig.description}</p>
          </div>

          <div className="tab-list" role="tablist" aria-label="Agent dossier sections">
            {bootstrap.copy.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                data-tab={tab.id}
                className={`tab-button${activeTab === tab.id ? ' is-active' : ''}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                onClick={() => activateTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="inline-alert" role="status">
              {error}
            </div>
          )}

          <section
            id="panel-live"
            role="tabpanel"
            aria-labelledby="tab-live"
            hidden={activeTab !== 'live'}
            className="panel"
          >
            <div className="live-grid">
              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">Current loop</p>
                  <p className="meta-copy">{formatDateTime(Date.now())}</p>
                </div>
                <h3>{bootstrap.identity.name} is {stateLabel.toLowerCase()}.</h3>
                <p className="body-copy">
                  The runtime is live on {bootstrap.meta.platform}. Recent events and monologues stream in
                  below as the agent scans, writes, publishes, and reflects.
                </p>

                <ul className="timeline">
                  {recentEvents.slice(0, 12).map((event) => (
                    <li key={createEventKey(event)} className="timeline-item">
                      <div>
                        <p className="timeline-title">{formatEventTitle(event)}</p>
                        <p className="timeline-body">{formatEventBody(event)}</p>
                      </div>
                      <time className="timeline-time" dateTime={new Date(event.ts).toISOString()}>
                        {formatRelativeTime(event.ts)}
                      </time>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="card">
                <div className="card-heading">
                  <p className="eyebrow">Field notes</p>
                  <p className="meta-copy">Latest monologues</p>
                </div>
                <div className="field-notes">
                  {recentEvents.filter((event) => event.type === 'monologue').slice(0, 6).map((event) => (
                    <blockquote key={createEventKey(event)} className="note">
                      <p>{String(event.text ?? '')}</p>
                      <footer>
                        <span>{formatStateLabel(String(event.state ?? currentState))}</span>
                        <time dateTime={new Date(event.ts).toISOString()}>{formatRelativeTime(event.ts)}</time>
                      </footer>
                    </blockquote>
                  ))}
                </div>
              </article>

              <article className="card">
                <div className="card-heading">
                  <p className="eyebrow">Wallets</p>
                  <p className="meta-copy">Public addresses</p>
                </div>
                <WalletRow
                  label="EVM"
                  value={bootstrap.transparency.wallets.evm}
                  copiedValue={copiedValue}
                  onCopy={handleCopy}
                />
                <WalletRow
                  label="Solana"
                  value={bootstrap.transparency.wallets.solana}
                  copiedValue={copiedValue}
                  onCopy={handleCopy}
                />
              </article>

              <article className="card">
                <div className="card-heading">
                  <p className="eyebrow">Skills</p>
                  <p className="meta-copy">
                    {bootstrap.transparency.skills.hotReloadEnabled ? 'Hot reload on' : 'Hot reload off'}
                  </p>
                </div>
                <div className="chip-list">
                  {activeSkills.map((skill) => (
                    <span key={skill.name} className="chip">
                      {skill.name}
                    </span>
                  ))}
                </div>
              </article>

              <article className="card">
                <div className="card-heading">
                  <p className="eyebrow">Costs</p>
                  <p className="meta-copy">Model usage summary</p>
                </div>

                {bootstrap.transparency.costs.enabled ? (
                  <>
                    <dl className="cost-grid">
                      <Metric label="Calls" value={formatCompactNumber(bootstrap.transparency.costs.totalCalls)} />
                      <Metric label="Failures" value={formatCompactNumber(bootstrap.transparency.costs.failedCalls)} />
                      <Metric label="Cost" value={formatCurrency(bootstrap.transparency.costs.totalCostUsd)} />
                      <Metric label="Tokens" value={formatCompactNumber(bootstrap.transparency.costs.totalTokens)} />
                    </dl>

                    <ul className="model-list">
                      {bootstrap.transparency.costs.byModel.slice(0, 4).map((model) => (
                        <li key={model.modelId}>
                          <div>
                            <p className="timeline-title">{model.modelId}</p>
                            <p className="timeline-body">{model.calls} calls</p>
                          </div>
                          <span className="meta-copy">{formatCurrency(model.costUsd)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="empty-state">{bootstrap.transparency.costs.reason}</p>
                )}
              </article>
            </div>
          </section>

          <section
            id="panel-editorial"
            role="tabpanel"
            aria-labelledby="tab-editorial"
            hidden={activeTab !== 'editorial'}
            className="panel"
          >
            {editorialPosts.length === 0 ? (
              <article className="card empty-card">
                <p className="eyebrow">Editorial</p>
                <p className="empty-state">{bootstrap.copy.emptyEditorial}</p>
              </article>
            ) : (
              <>
                <div className="editorial-grid">
                  {editorialPosts.map((post) => (
                    <EditorialCard key={post.id} post={post} />
                  ))}
                </div>

                {hasMorePosts && (
                  <div className="load-more-wrap">
                    <button className="button button-primary" onClick={handleLoadMore} disabled={loadingMore}>
                      {loadingMore ? 'Loading more…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section
            id="panel-worldview"
            role="tabpanel"
            aria-labelledby="tab-worldview"
            hidden={activeTab !== 'worldview'}
            className="panel"
          >
            <div className="worldview-grid">
              <ListCard title="Beliefs" items={bootstrap.worldview.beliefs} />
              <ListCard title="Themes" items={bootstrap.worldview.themes} />
              <ListCard title="Punches up" items={bootstrap.worldview.punchesUp} />
              <ListCard title="Respects" items={bootstrap.worldview.respects} />

              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">Method</p>
                  <p className="meta-copy">Public standards and constraints</p>
                </div>
                <div className="dual-text">
                  <div>
                    <h3>Voice</h3>
                    <p className="body-copy">{bootstrap.engagement.voiceDescription}</p>
                  </div>
                  <div>
                    <h3>Persona</h3>
                    <p className="body-copy">{bootstrap.identity.persona}</p>
                  </div>
                </div>
                <div className="worldview-method-grid">
                  <ListCard title="Engagement rules" items={bootstrap.engagement.rules} compact />
                  <ListCard title="Restrictions" items={bootstrap.governance.restrictions} compact />
                </div>
              </article>
            </div>
          </section>

          <section
            id="panel-about"
            role="tabpanel"
            aria-labelledby="tab-about"
            hidden={activeTab !== 'about'}
            className="panel"
          >
            <div className="about-grid">
              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">About</p>
                  <p className="meta-copy">{bootstrap.identity.creator}</p>
                </div>
                <div className="about-meta">
                  <Metric label="Born" value={bootstrap.identity.born || 'Unspecified'} />
                  <Metric label="Platform" value={bootstrap.meta.platform} />
                  <Metric label="Source hash" value={bootstrap.meta.sourceHash} mono />
                  <Metric label="Motto" value={bootstrap.identity.motto} />
                </div>
                <div className="longform-block">
                  {renderLongform(bootstrap.identity.bio || 'No public biography yet.')}
                </div>
              </article>

              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">Process</p>
                  <p className="meta-copy">
                    {bootstrap.processPlan.workflows.length} workflows · {bootstrap.processPlan.backgroundTasks.length} background tasks
                  </p>
                </div>
                <div className="process-grid">
                  <section className="process-column">
                    <h3>Workflows</h3>
                    <ul className="process-list">
                      {bootstrap.processPlan.workflows.map((workflow) => (
                        <li key={workflow.trigger.timerKey}>
                          <div className="process-item-head">
                            <strong>{workflow.name}</strong>
                            <span className="meta-copy">
                              Every {formatInterval(workflow.trigger.intervalMs)} · priority {workflow.priority}
                            </span>
                          </div>
                          <p className="body-copy">{workflow.instruction}</p>
                          {workflow.skills && workflow.skills.length > 0 && (
                            <div className="chip-list">
                              {workflow.skills.map((skill) => (
                                <span key={`${workflow.name}-${skill}`} className="chip">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="process-column">
                    <h3>Background tasks</h3>
                    <ul className="process-list">
                      {bootstrap.processPlan.backgroundTasks.length > 0 ? bootstrap.processPlan.backgroundTasks.map((task) => (
                        <li key={task.trigger.timerKey}>
                          <div className="process-item-head">
                            <strong>{task.name}</strong>
                            <span className="meta-copy">Every {formatInterval(task.trigger.intervalMs)}</span>
                          </div>
                          <p className="body-copy">
                            Runs <span className="mono-copy">{task.tool}</span>
                            {task.skill ? ` from ${task.skill}` : ''}.
                          </p>
                        </li>
                      )) : (
                        <li>
                          <p className="empty-state">No background tasks configured.</p>
                        </li>
                      )}
                    </ul>
                  </section>
                </div>
              </article>

              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">Constitution</p>
                  <p className="meta-copy">Immutable rules</p>
                </div>
                <div className="longform-block">
                  {renderLongform(bootstrap.identity.constitution)}
                </div>
              </article>

              <article className="card panel-wide">
                <div className="card-heading">
                  <p className="eyebrow">Creative process</p>
                  <p className="meta-copy">Current workflow</p>
                </div>
                <div className="longform-block">
                  {renderLongform(bootstrap.creativeProcess)}
                </div>
              </article>

              <ListCard title="Upgrade rules" items={bootstrap.governance.upgradeRules} />
              <ListCard title="Financial commitments" items={bootstrap.governance.financialCommitments} />

              {bootstrap.style && (
                <article className="card panel-wide">
                  <div className="card-heading">
                    <p className="eyebrow">Visual system</p>
                    <p className="meta-copy">{bootstrap.style.name}</p>
                  </div>
                  <div className="style-grid">
                    <div>
                      <h3>Description</h3>
                      <p className="body-copy">{bootstrap.style.description}</p>
                    </div>
                    <div>
                      <h3>Visual identity</h3>
                      <p className="body-copy">{bootstrap.style.visualIdentity}</p>
                    </div>
                    <div>
                      <h3>Composition</h3>
                      <p className="body-copy">{bootstrap.style.compositionPrinciples}</p>
                    </div>
                    <div>
                      <h3>Rendering rules</h3>
                      <p className="body-copy">{bootstrap.style.renderingRules}</p>
                    </div>
                  </div>
                </article>
              )}
            </div>
          </section>
        </section>

        <VerificationSection
          evmAddress={bootstrap.transparency.wallets.evm}
          sourceHash={bootstrap.meta.sourceHash}
          compiledAt={bootstrap.meta.compiledAt}
          repoUrl={bootstrap.meta.repoUrl}
          compiledAgent={bootstrap.compiledAgent}
          template={bootstrap.meta.template}
        />
      </main>
    </div>
  )
}

interface VerifyResult {
  accountVerified?: boolean
  signatureVerified: boolean
  error?: string
}

function VerificationSection({
  evmAddress,
  sourceHash,
  compiledAt,
  repoUrl,
  compiledAgent,
  template,
}: {
  evmAddress: string | null
  sourceHash: string
  compiledAt: number
  repoUrl: string | null
  compiledAgent: Record<string, unknown>
  template: string
}) {
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')
  const [signature, setSignature] = useState('')
  const [loadingLink, setLoadingLink] = useState(false)
  const [loadingSig, setLoadingSig] = useState(false)
  const [linkResult, setLinkResult] = useState<VerifyResult | null>(null)
  const [sigResult, setSigResult] = useState<VerifyResult | null>(null)
  const [sourceExpanded, setSourceExpanded] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  async function handleVerifyLink() {
    setLoadingLink(true)
    setLinkResult(null)
    try {
      const res = await fetch('/api/verify/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      setLinkResult(await res.json() as VerifyResult)
    } catch {
      setLinkResult({ signatureVerified: false, error: 'Request failed.' })
    } finally {
      setLoadingLink(false)
    }
  }

  async function handleVerifySignature() {
    setLoadingSig(true)
    setSigResult(null)
    try {
      const res = await fetch('/api/verify/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      })
      setSigResult(await res.json() as VerifyResult)
    } catch {
      setSigResult({ signatureVerified: false, error: 'Request failed.' })
    } finally {
      setLoadingSig(false)
    }
  }

  return (
    <section className="verify-section">
      <div className="tab-header">
        <h2 className="section-title">Verification</h2>
        <p className="tab-description">Verification utilities for this agent.</p>
      </div>

      <article className="card">
      <div className="verify-row">
        <div className="verify-row-info">
          <h3>Public key</h3>
          <p className="verify-description">
            The agent&rsquo;s EVM address used to sign all published content.
          </p>
        </div>
        <div className="verify-row-value">
          {evmAddress ? (
            <button
              className="verify-pubkey-btn"
              onClick={() => {
                void navigator.clipboard.writeText(evmAddress)
                setKeyCopied(true)
                setTimeout(() => setKeyCopied(false), 1800)
              }}
              title="Copy to clipboard"
            >
              <span className="mono-copy verify-pubkey">{evmAddress}</span>
              <span className="verify-copy-icon">{keyCopied ? '\u2713' : '\u2398'}</span>
            </button>
          ) : (
            <p className="mono-copy verify-pubkey">No EVM wallet configured</p>
          )}
        </div>
      </div>

      <hr className="verify-divider" />

      <div className="verify-row">
        <div className="verify-row-info">
          <h3>Verify link</h3>
          <p className="verify-description">
            Paste a tweet or article URL to verify it was published by this agent.
          </p>
        </div>
        <div className="verify-row-inputs">
          <input
            className="verify-input"
            type="url"
            placeholder="https://agent.substack.com/p/article-slug"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) void handleVerifyLink() }}
          />
          <button
            className="verify-submit"
            onClick={handleVerifyLink}
            disabled={loadingLink || !url.trim()}
          >
            {loadingLink ? 'Verifying\u2026' : 'Verify'}
          </button>
          {linkResult && <VerifyInlineResult result={linkResult} />}
        </div>
      </div>

      <hr className="verify-divider" />

      <div className="verify-row">
        <div className="verify-row-info">
          <h3>Verify signature</h3>
          <p className="verify-description">
            Paste a message and its signature to verify it was signed by this agent{evmAddress ? ` (${evmAddress.slice(0, 6)}\u2026${evmAddress.slice(-4)})` : ''}.
          </p>
        </div>
        <div className="verify-row-inputs">
          <textarea
            className="verify-textarea"
            placeholder="Message content"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <input
            className="verify-input"
            type="text"
            placeholder="0x signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && message.trim() && signature.trim()) void handleVerifySignature() }}
          />
          <button
            className="verify-submit"
            onClick={handleVerifySignature}
            disabled={loadingSig || !message.trim() || !signature.trim()}
          >
            {loadingSig ? 'Verifying\u2026' : 'Verify'}
          </button>
          {sigResult && <VerifyInlineResult result={sigResult} />}
        </div>
      </div>

      <hr className="verify-divider" />

      <div className="verify-row">
        <div className="verify-row-info">
          <h3>Source code</h3>
          <p className="verify-description">
            Verify the agent&rsquo;s source code integrity. The source hash is a deterministic fingerprint
            of the agent&rsquo;s soul and constitution at compile time.
          </p>
        </div>
        <div className="verify-source-card">
          <div className="verify-source-header">
            <div className="verify-source-status">
              <span className="verify-source-pill">{'\u2713'} Compiled</span>
              <span className="meta-copy">{formatDateTime(compiledAt)}</span>
            </div>
          </div>
          <div className="verify-source-tiles verify-source-tiles-top">
            {repoUrl ? (
              <a href={repoUrl} target="_blank" rel="noreferrer" className="verify-source-tile verify-source-tile-link">
                <p className="verify-source-label">Repository</p>
                <p className="verify-source-value">{repoUrl.replace(/^https?:\/\/github\.com\//, '')}</p>
              </a>
            ) : (
              <div className="verify-source-tile">
                <p className="verify-source-label">Repository</p>
                <p className="verify-source-value meta-copy">Not available</p>
              </div>
            )}
            <div className="verify-source-tile">
              <p className="verify-source-label">Template</p>
              <p className="verify-source-value">{template}</p>
            </div>
          </div>
          <div className="verify-source-tiles">
            <div className="verify-source-tile">
              <p className="verify-source-label">Source hash</p>
              <p className="verify-source-value mono-copy">{sourceHash}</p>
            </div>
            <div className="verify-source-tile">
              <p className="verify-source-label">Compiled</p>
              <p className="verify-source-value">{formatRelativeTime(compiledAt)}</p>
            </div>
          </div>
          <button
            type="button"
            className="verify-source-toggle"
            onClick={() => setSourceExpanded((v) => !v)}
            aria-expanded={sourceExpanded}
          >
            {sourceExpanded ? 'Hide details' : 'Show details'}
            <span className={`verify-source-chevron${sourceExpanded ? ' is-expanded' : ''}`}>{'\u203A'}</span>
          </button>
          {sourceExpanded && (
            <div className="verify-source-details">
              <p className="verify-source-label">Compiled agent JSON</p>
              <pre className="verify-source-json">{JSON.stringify(compiledAgent, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
      </article>
    </section>
  )
}

function VerifyInlineResult({ result }: { result: VerifyResult }) {
  const allPassed = result.signatureVerified && (result.accountVerified === undefined || result.accountVerified)

  return (
    <div className={`verify-inline-result ${allPassed ? 'verify-inline-pass' : 'verify-inline-fail'}`}>
      <p className="verify-inline-title">
        {allPassed ? '\u2713 Verification succeeded' : '\u2717 Verification failed'}
      </p>
      <ul className="verify-inline-checks">
        {result.accountVerified !== undefined && (
          <li className={result.accountVerified ? 'verify-check' : 'verify-fail'}>
            {result.accountVerified ? '\u2713' : '\u2717'} Account {result.accountVerified ? 'verified' : 'not verified'}
          </li>
        )}
        <li className={result.signatureVerified ? 'verify-check' : 'verify-fail'}>
          {result.signatureVerified ? '\u2713' : '\u2717'} Signature {result.signatureVerified ? 'verified' : 'failed'}
        </li>
        {result.error && <li className="verify-fail">{result.error}</li>}
      </ul>
    </div>
  )
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd className={mono ? 'mono-copy' : ''}>{value}</dd>
    </div>
  )
}

function ListCard({
  title,
  items,
  compact = false,
}: {
  title: string
  items: string[]
  compact?: boolean
}) {
  return (
    <article className="card">
      <div className="card-heading">
        <p className="eyebrow">{title}</p>
        <p className="meta-copy">{items.length} items</p>
      </div>
      <ul className={`bullet-list${compact ? ' is-compact' : ''}`}>
        {items.length > 0 ? items.map((item) => <li key={item}>{item}</li>) : <li>No public details yet.</li>}
      </ul>
    </article>
  )
}

function WalletRow({
  label,
  value,
  copiedValue,
  onCopy,
}: {
  label: string
  value: string | null
  copiedValue: string | null
  onCopy: (value: string) => void | Promise<void>
}) {
  return (
    <div className="wallet-row">
      <div>
        <p className="eyebrow">{label}</p>
        <p className="mono-copy wallet-value">{value ?? 'Unavailable'}</p>
      </div>
      {value && (
        <button className="button button-ghost" onClick={() => void onCopy(value)}>
          {copiedValue === value ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
}

function getInitialTab(): TabId {
  const next = window.location.hash.replace('#', '') as TabId
  return TAB_ORDER.includes(next) ? next : 'editorial'
}

function EditorialCard({ post }: { post: PublicPostRecord }) {
  const targetUrl = post.articleUrl ?? post.videoUrl ?? post.imageUrl
  const content = (
    <>
      <div className="card-heading">
        <p className="eyebrow">{formatPostType(post.type)}</p>
        <p className="meta-copy">{formatDateTime(post.postedAt)}</p>
      </div>
      <h3 className="editorial-title">{getEditorialTitle(post)}</h3>
      <p className="editorial-summary">{getEditorialSummary(post)}</p>
      <div className="editorial-link-row">
        {targetUrl ? (
          <span className="editorial-link-label">
            {post.articleUrl ? 'Read article' : 'Open post'}
          </span>
        ) : (
          <span className="meta-copy mono-copy">Platform ID: {post.platformId}</span>
        )}
      </div>
    </>
  )

  if (!targetUrl) {
    return (
      <article className="card editorial-card editorial-card-static">
        <div className="editorial-copy">{content}</div>
      </article>
    )
  }

  return (
    <a className="card editorial-card editorial-card-link" href={targetUrl}>
      <div className="editorial-copy">{content}</div>
    </a>
  )
}

function createEventKey(event: ConsoleEvent): string {
  return JSON.stringify(event)
}

function normalizePost(input: Record<string, unknown>): PublicPostRecord {
  const engagement = typeof input.engagement === 'object' && input.engagement
    ? input.engagement as PublicPostRecord['engagement']
    : {
        likes: Number(input.likes ?? 0),
        shares: Number(input.shares ?? 0),
        comments: Number(input.comments ?? 0),
        views: Number(input.views ?? 0),
        lastChecked: Number(input.engagement_checked_at ?? 0),
      }

  return {
    id: String(input.id ?? ''),
    platformId: String(input.platformId ?? input.platform_id ?? ''),
    contentId: input.contentId
      ? String(input.contentId)
      : input.content_id
        ? String(input.content_id)
        : null,
    text: String(input.text ?? ''),
    summary: input.summary ? String(input.summary) : undefined,
    imageUrl: normalizeMediaUrl(input.imageUrl ?? input.image_url),
    videoUrl: normalizeMediaUrl(input.videoUrl ?? input.video_url),
    articleUrl: input.articleUrl
      ? String(input.articleUrl)
      : input.article_url
        ? String(input.article_url)
        : undefined,
    referenceId: input.referenceId
      ? String(input.referenceId)
      : input.reference_id
        ? String(input.reference_id)
        : undefined,
    type: String(input.type ?? 'flagship'),
    signature: input.signature ? String(input.signature) : undefined,
    signerAddress: input.signerAddress
      ? String(input.signerAddress)
      : input.signer_address
        ? String(input.signer_address)
        : undefined,
    urlSignature: input.urlSignature
      ? String(input.urlSignature)
      : input.url_signature
        ? String(input.url_signature)
        : undefined,
    postedAt: Number(input.postedAt ?? input.posted_at ?? 0),
    engagement,
  }
}

function normalizeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/images/')) {
    return value
  }

  const segments = value.split(/[\\/]/)
  const filename = segments[segments.length - 1]
  return filename ? `/images/${encodeURIComponent(filename)}` : undefined
}

function formatStateLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ts)
}

function formatRelativeTime(ts: number): string {
  const diffMs = ts - Date.now()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (Math.abs(diffMs) >= day) return formatter.format(Math.round(diffMs / day), 'day')
  if (Math.abs(diffMs) >= hour) return formatter.format(Math.round(diffMs / hour), 'hour')
  return formatter.format(Math.round(diffMs / minute), 'minute')
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPostType(value: string): string {
  return value === 'quickhit'
    ? 'Quick hit'
    : value === 'flagship'
      ? 'Flagship'
      : value === 'article'
        ? 'Article'
        : formatStateLabel(value)
}

function getEditorialTitle(post: PublicPostRecord): string {
  const title = post.text.trim()
  if (!title) return formatPostType(post.type)
  return excerpt(title, 120)
}

function getEditorialSummary(post: PublicPostRecord): string {
  if (post.summary && post.summary.trim().length > 0) {
    return excerpt(post.summary, 220)
  }

  if (post.type === 'article') {
    return 'No article summary was archived for this piece yet.'
  }

  return excerpt(post.text, 220)
}

function formatInterval(intervalMs: number): string {
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (intervalMs % week === 0) return `${intervalMs / week}w`
  if (intervalMs % day === 0) return `${intervalMs / day}d`
  if (intervalMs % hour === 0) return `${intervalMs / hour}h`
  if (intervalMs % minute === 0) return `${intervalMs / minute}m`
  return `${Math.round(intervalMs / 1000)}s`
}

function excerpt(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}…`
}

function formatEventTitle(event: ConsoleEvent): string {
  switch (event.type) {
    case 'monologue':
      return formatStateLabel(String(event.state ?? 'monologue'))
    case 'scan':
      return `Scanned ${String(event.source ?? 'source')}`
    case 'shortlist':
      return 'Shortlist updated'
    case 'ideate':
      return 'Concepts generated'
    case 'generate':
      return 'Visual generation'
    case 'critique':
      return 'Editorial critique'
    case 'post':
      return 'Published'
    case 'engage':
      return 'Engagement sent'
    case 'skill':
      return `Skill: ${String(event.skill ?? 'runtime')}`
    case 'state_change':
      return `${formatStateLabel(String(event.from ?? 'state'))} → ${formatStateLabel(String(event.to ?? 'state'))}`
    case 'metric':
      return `Metric: ${String(event.name ?? 'value')}`
    default:
      return formatStateLabel(event.type)
  }
}

function formatEventBody(event: ConsoleEvent): string {
  switch (event.type) {
    case 'monologue':
      return excerpt(String(event.text ?? ''), 160)
    case 'scan':
      return `${String(event.signalCount ?? 0)} signals captured`
    case 'shortlist':
      return `${Array.isArray(event.topics) ? event.topics.length : 0} topics retained`
    case 'ideate':
      return `${Array.isArray(event.concepts) ? event.concepts.length : 0} concepts on ${String(event.topicId ?? 'the current topic')}`
    case 'generate':
      return `${String(event.variantCount ?? 0)} visual variants requested`
    case 'critique':
      return excerpt(String(event.critique ?? ''), 140)
    case 'post':
      return excerpt(String(event.text ?? ''), 140)
    case 'engage':
      return excerpt(String(event.text ?? ''), 140)
    case 'skill':
      return String(event.action ?? 'Skill activity recorded')
    case 'metric':
      return `${String(event.value ?? '')}`
    default:
      return 'Runtime activity recorded.'
  }
}

function renderLongform(text: string): Array<ReactElement> {
  const lines = text.trim().split('\n')
  const blocks: Array<ReactElement> = []
  let paragraph: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null
  let key = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p-${key++}`} className="body-copy">
        {paragraph.join(' ')}
      </p>,
    )
    paragraph = []
  }

  const flushList = () => {
    if (!list) return
    const Tag = list.kind
    blocks.push(
      <Tag key={`l-${key++}`} className="longform-list">
        {list.items.map((item, index) => <li key={`${key}-${index}`}>{item}</li>)}
      </Tag>,
    )
    list = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.startsWith('## ')) {
      flushParagraph()
      flushList()
      blocks.push(<h3 key={`h-${key++}`}>{line.slice(3)}</h3>)
      continue
    }

    const bullet = line.match(/^-\s+(.*)$/)
    const ordered = line.match(/^\d+\.\s+(.*)$/)
    if (bullet || ordered) {
      flushParagraph()
      const kind = ordered ? 'ol' : 'ul'
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, items: [] }
      }
      list.items.push((ordered?.[1] ?? bullet?.[1] ?? '').trim())
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return blocks.length > 0
    ? blocks
    : [<p key="empty" className="empty-state">No public details yet.</p>]
}
