# Political Analyst Example

A daily geopolitical newsletter agent. Scans news and political Twitter, writes analytical briefings, publishes to Substack.

## Setup

```bash
# From the media-agent root
cp examples/political-analyst/SOUL.md ./SOUL.md
cp examples/political-analyst/PROCESS.md ./PROCESS.md
cp examples/political-analyst/constitution.md ./constitution.md

# Configure for Substack
PLATFORM=substack
SUBSTACK_HANDLE=your-handle
RSS_FEEDS=https://feeds.reuters.com/reuters/worldNews,https://feeds.bbci.co.uk/news/world/rss.xml,https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml

# Start Chrome for browser automation
google-chrome --remote-debugging-port=9222

# Run
bun dev
```

## What It Does

**Daily Briefing (every 24 hours):**
- Scores all signals from past 24 hours
- Identifies 3-5 most significant geopolitical developments
- Writes a structured long-form briefing (lead story, analysis, signals to watch)
- Publishes to Substack

**Quick Analysis (every 6 hours):**
- Checks for breaking developments scoring above 8/10
- Only publishes if something genuinely significant breaks
- Short, focused analysis piece

**Engagement (every 30 minutes):**
- Responds to reader comments with substantive answers

**Reflection (weekly):**
- Reviews past analysis for blind spots
- Evolves analytical themes
