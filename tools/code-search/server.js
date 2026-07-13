const http = require('http')
const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const PORT    = 4321
const SRC_DIR = path.resolve(__dirname, '../../src')

// ── Search logic ─────────────────────────────────────────────────────────────
function searchCode(query) {
  if (!query || query.trim().length < 2) return []
  const q = query.replace(/"/g, '').replace(/\\/g, '').trim()
  try {
    // Use findstr (Windows built-in, always available)
    const cmd = `findstr /s /n /i /c:"${q}" "${SRC_DIR}\\*.ts" "${SRC_DIR}\\*.tsx" "${SRC_DIR}\\*.js" "${SRC_DIR}\\*.css" 2>nul`
    const out  = execSync(cmd, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
    if (!out) return []

    const results = {}
    for (const line of out.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx < 0) continue
      // On Windows, findstr output: C:\...\file.ts:12:content
      // Split carefully — path may contain colons (drive letter)
      const match = line.match(/^(.+):(\d+):(.*)$/)
      if (!match) continue
      let [, filePath, lineNum, content] = match
      filePath = filePath.trim()
      const rel = path.relative(SRC_DIR, filePath).replace(/\\/g, '/')
      if (!results[rel]) results[rel] = { file: rel, matches: [] }
      results[rel].matches.push({ line: parseInt(lineNum), content: content.trim() })
    }
    return Object.values(results).sort((a, b) => a.file.localeCompare(b.file))
  } catch (e) {
    // findstr returns exit 1 when no matches — that's ok
    return []
  }
}

// ── Serve HTML ────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code Search — Export System</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
  header{background:#1a1d27;border-bottom:1px solid #2d3148;padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10}
  header h1{font-size:15px;font-weight:700;color:#fff;white-space:nowrap}
  header span{font-size:12px;color:#64748b}
  #search{flex:1;background:#0f1117;border:1.5px solid #2d3148;border-radius:8px;padding:9px 14px;font-size:14px;color:#e2e8f0;outline:none;transition:.15s border-color}
  #search:focus{border-color:#22A87A}
  #search::placeholder{color:#4b5563}
  #stats{font-size:12px;color:#6b7280;padding:10px 24px;border-bottom:1px solid #1e2235;min-height:34px;display:flex;align-items:center;gap:8px}
  #results{padding:16px 24px;display:flex;flex-direction:column;gap:16px}
  .file-block{background:#1a1d27;border:1px solid #2d3148;border-radius:10px;overflow:hidden}
  .file-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1e2235;border-bottom:1px solid #2d3148;cursor:pointer;user-select:none}
  .file-header:hover{background:#252a3a}
  .file-icon{font-size:13px}
  .file-path{font-family:monospace;font-size:12px;color:#60a5fa;flex:1}
  .match-count{font-size:11px;background:#22A87A22;color:#22A87A;padding:2px 8px;border-radius:12px;font-weight:600}
  .matches{display:flex;flex-direction:column}
  .match-row{display:grid;grid-template-columns:52px 1fr;border-top:1px solid #1e2235}
  .match-row:hover{background:#1e2235}
  .line-num{font-family:monospace;font-size:11px;color:#4b5563;padding:6px 0 6px 14px;text-align:right;user-select:none;background:#161925}
  .match-content{font-family:monospace;font-size:12px;color:#d1d5db;padding:6px 14px;white-space:pre-wrap;word-break:break-all;overflow:hidden}
  .match-content mark{background:#22A87A33;color:#4ade80;border-radius:2px;padding:0 1px}
  #loading{display:none;align-items:center;gap:8px;color:#6b7280;padding:10px 24px;font-size:13px}
  .spin{width:14px;height:14px;border:2px solid #2d3148;border-top-color:#22A87A;border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .empty{text-align:center;padding:60px 24px;color:#4b5563}
  .empty p{margin-top:8px;font-size:13px}
  kbd{display:inline-block;background:#1e2235;border:1px solid #2d3148;border-radius:4px;padding:2px 6px;font-family:monospace;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<header>
  <h1>🔍 Code Search</h1>
  <span>export-system / src</span>
  <input id="search" type="text" placeholder="Type to search... (min 2 chars)" autocomplete="off" autofocus spellcheck="false">
  <span><kbd>Esc</kbd> to clear</span>
</header>
<div id="loading"><div class="spin"></div>Searching...</div>
<div id="stats"></div>
<div id="results"></div>

<script>
const searchEl = document.getElementById('search')
const resultsEl = document.getElementById('results')
const statsEl   = document.getElementById('stats')
const loadingEl = document.getElementById('loading')
let timer = null

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function highlight(content, query) {
  const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&') + ')', 'gi')
  return esc(content).replace(re, '<mark>$1</mark>')
}

function renderResults(data, query) {
  if (!data.length) {
    resultsEl.innerHTML = '<div class="empty"><div style="font-size:32px">🔎</div><p>No results found for <strong>' + esc(query) + '</strong></p></div>'
    statsEl.textContent = '0 results'
    return
  }
  const totalMatches = data.reduce((s,f)=>s+f.matches.length, 0)
  statsEl.innerHTML = '<span>' + totalMatches + ' match' + (totalMatches!==1?'es':'') + ' across <strong>' + data.length + '</strong> file' + (data.length!==1?'s':'') + '</span>'

  resultsEl.innerHTML = data.map(f => {
    const ext = f.file.split('.').pop()
    const icon = ext === 'tsx' || ext === 'jsx' ? '⚛️' : ext === 'ts' || ext === 'js' ? '📜' : ext === 'css' ? '🎨' : '📄'
    return \`<div class="file-block">
      <div class="file-header">
        <span class="file-icon">\${icon}</span>
        <span class="file-path">src/\${esc(f.file)}</span>
        <span class="match-count">\${f.matches.length} match\${f.matches.length!==1?'es':''}</span>
      </div>
      <div class="matches">
        \${f.matches.map(m => \`<div class="match-row">
          <span class="line-num">\${m.line}</span>
          <span class="match-content">\${highlight(m.content, query)}</span>
        </div>\`).join('')}
      </div>
    </div>\`
  }).join('')
}

async function doSearch(q) {
  if (q.trim().length < 2) {
    resultsEl.innerHTML = '<div class="empty"><div style="font-size:40px">🔍</div><p>Type at least 2 characters to search across all source files</p></div>'
    statsEl.textContent = ''
    loadingEl.style.display = 'none'
    return
  }
  loadingEl.style.display = 'flex'
  resultsEl.innerHTML = ''
  statsEl.textContent = ''
  try {
    const res  = await fetch('/search?q=' + encodeURIComponent(q))
    const data = await res.json()
    renderResults(data, q)
  } catch(e) {
    resultsEl.innerHTML = '<div class="empty"><p>Search error: ' + esc(String(e)) + '</p></div>'
  } finally {
    loadingEl.style.display = 'none'
  }
}

searchEl.addEventListener('input', () => {
  clearTimeout(timer)
  timer = setTimeout(() => doSearch(searchEl.value), 280)
})
searchEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchEl.value = ''; doSearch('') }
})

// Show welcome state
resultsEl.innerHTML = '<div class="empty"><div style="font-size:40px">🔍</div><p>Type at least 2 characters to search across all source files</p><p style="margin-top:6px;font-size:12px;color:#374151">Searches .ts · .tsx · .js · .css files inside src/</p></div>'
</script>
</body>
</html>`

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/search') {
    const q       = url.searchParams.get('q') || ''
    const results = searchCode(q)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(results))
    return
  }

  // Serve index
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(HTML)
})

server.listen(PORT, () => {
  console.log(`\n  Code Search running at: http://localhost:${PORT}\n`)
})
