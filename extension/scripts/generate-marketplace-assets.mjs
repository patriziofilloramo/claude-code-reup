import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import { extensionRoot, readBrandDefinition } from './brand-source.mjs'

const WIDTH = 1280
const HEIGHT = 720
const outputDirectory = join(extensionRoot, 'media', 'marketplace')
const brand = await readBrandDefinition()

await mkdir(outputDirectory, { recursive: true })

const frames = [
  dashboardSvg('home', 'See every project and the session worth continuing now.', '', 0, 418, 246),
  dashboardSvg(
    'search',
    'Search titles, projects, branches, tags and session state instantly.',
    'branch:main',
    1,
    595,
    62
  ),
  dashboardSvg(
    'inspect',
    'Inspect the goal, latest answer, plan, files and resume risks before opening.',
    'branch:main',
    1,
    840,
    290
  ),
  dashboardSvg(
    'resume',
    'Resume in Claude Code or the terminal — Reup remembers your choice.',
    'branch:main',
    1,
    1020,
    367
  ),
]
const frameBuffers = await Promise.all(
  frames.map((frame) => sharp(Buffer.from(frame)).png().toBuffer())
)

await sharp({
  create: {
    width: WIDTH,
    height: HEIGHT * frameBuffers.length,
    channels: 4,
    background: '#101315',
    pageHeight: HEIGHT,
  },
})
  .composite(frameBuffers.map((input, index) => ({ input, left: 0, top: HEIGHT * index })))
  .gif({ delay: [1700, 1700, 1900, 2300], effort: 8, loop: 0 })
  .toFile(join(outputDirectory, 'dashboard-workflow.gif'))

await sharp(Buffer.from(cockpitSvg())).png().toFile(join(outputDirectory, 'workspace-cockpit.png'))

function dashboardSvg(stage, caption, query, selected, cursorX, cursorY) {
  const sessions =
    stage === 'home'
      ? [
          ['Fix release blocker', 'reup · 12m ago · 84 messages', 'main'],
          ['Implement resume dashboard', 'reup · 1h ago · 201 messages', 'feat/dashboard'],
          ['Review authentication migration', 'api · 3h ago · 56 messages', 'main'],
          ['Polish onboarding copy', 'web · yesterday · 31 messages', 'content'],
        ]
      : [
          ['Fix release blocker', 'reup · 12m ago · 84 messages', 'main'],
          ['Review authentication migration', 'api · 3h ago · 56 messages', 'main'],
          ['Prepare launch checklist', 'web · yesterday · 42 messages', 'main'],
        ]
  const sessionRows = sessions
    .map(([title, meta, branch], index) => sessionRow(title, meta, branch, index, selected))
    .join('')
  const projects = [
    ['reup', '11', true],
    ['api-platform', '6', false],
    ['launch-site', '4', false],
    ['mobile-client', '3', false],
  ]
    .map(
      ([name, count, active], index) => `
      <g transform="translate(18 ${246 + index * 42})">
        ${active ? '<rect width="202" height="34" rx="8" fill="#20272b"/>' : ''}
        <circle cx="14" cy="17" r="4" fill="${index === 0 ? '#47d7a1' : '#667078'}"/>
        <text x="28" y="22" class="body">${name}</text>
        <text x="183" y="22" class="muted">${count}</text>
      </g>`
    )
    .join('')
  const detailTitle = selected === 0 ? 'Fix release blocker' : 'Review authentication migration'
  const detail =
    stage === 'home'
      ? emptyDetail()
      : `
      <text x="790" y="148" class="eyebrow">READY TO RESUME</text>
      <text x="790" y="185" class="h1">${detailTitle}</text>
      <text x="790" y="212" class="muted">P:\\Projects\\reup · main · 84 messages</text>
      <rect x="790" y="236" width="454" height="74" rx="10" fill="#20272b"/>
      <rect x="790" y="236" width="4" height="74" rx="2" fill="${brand.color}"/>
      <text x="810" y="263" class="strong">Safe to resume</text>
      <text x="810" y="287" class="muted">Path and branch context match this workspace.</text>
      ${resumeButtons(stage)}
      <text x="790" y="412" class="section">WHAT YOU ASKED FOR</text>
      <text x="790" y="442" class="body">Verify the release path and remove the final blocker.</text>
      <text x="790" y="488" class="section">WHERE CLAUDE LEFT OFF</text>
      <text x="790" y="518" class="body">The fix is implemented. Integration tests are green;</text>
      <text x="790" y="544" class="body">the remaining step is packaging and a clean-host smoke test.</text>
      <text x="790" y="590" class="section">FILES TOUCHED</text>
      <text x="790" y="620" class="link">extension/src/dashboard.ts</text>
      <text x="790" y="646" class="link">tests/extension/dashboard-regressions.test.ts</text>`

  return svg(`
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#101315"/>
    <rect width="${WIDTH}" height="96" fill="#15191c"/>
    ${brandMark(24, 20, 52)}
    <text x="92" y="48" class="brand">Reup</text>
    <text x="92" y="70" class="subtitle">claude code</text>
    <rect x="232" y="22" width="556" height="48" rx="12" fill="#111619" stroke="#334149"/>
    <text x="254" y="53" class="${query ? 'body' : 'muted'}">${query || 'Find sessions, projects, branches, tags…'}</text>
    <rect x="661" y="30" width="116" height="32" rx="8" fill="#1b2226" stroke="#334149"/>
    <text x="680" y="52" class="button">Deep search</text>
    <text x="1000" y="49" class="section">LIMITS</text>
    <text x="1062" y="49" class="body">5h</text>
    <rect x="1092" y="42" width="58" height="6" rx="3" fill="#22343c"/>
    <rect x="1092" y="42" width="22" height="6" rx="3" fill="${brand.color}"/>
    <text x="1162" y="49" class="muted">18%</text>
    <rect x="0" y="96" width="238" height="558" fill="#14181b"/>
    <rect x="238" y="96" width="520" height="558" fill="#111518"/>
    <rect x="758" y="96" width="522" height="558" fill="#101315"/>
    <line x1="238" y1="96" x2="238" y2="654" stroke="#2a3034"/>
    <line x1="758" y1="96" x2="758" y2="654" stroke="#2a3034"/>
    <text x="18" y="132" class="section">FOCUS</text>
    <rect x="10" y="146" width="218" height="38" rx="8" fill="#20272b"/>
    <text x="22" y="171" class="body">All sessions</text>
    <text x="198" y="171" class="muted">24</text>
    <text x="22" y="210" class="muted">Active now</text>
    <text x="198" y="210" class="muted">2</text>
    <text x="18" y="238" class="section">PROJECTS</text>
    ${projects}
    <text x="266" y="132" class="section">${stage === 'home' ? 'CONTINUE NOW' : 'SEARCH RESULTS'}</text>
    ${sessionRows}
    ${detail}
    <rect x="0" y="654" width="${WIDTH}" height="66" fill="#15191c"/>
    <circle cx="28" cy="687" r="5" fill="${brand.color}"/>
    <text x="48" y="692" class="caption">${caption}</text>
    ${cursor(cursorX, cursorY)}
  `)
}

function cockpitSvg() {
  const rows = [
    ['●', 'Fix release blocker', '12m'],
    ['○', 'Implement resume dashboard', '1h'],
    ['!', 'Review authentication migration', '3h'],
    ['○', 'Polish onboarding copy', '1d'],
  ]
    .map(
      ([icon, title, age], index) => `
      <g transform="translate(38 ${210 + index * 44})">
        ${index === 0 ? '<rect x="-16" y="-23" width="452" height="38" rx="7" fill="#253039"/>' : ''}
        <text x="0" y="2" class="${icon === '!' ? 'warn' : icon === '●' ? 'good' : 'muted'}">${icon}</text>
        <text x="28" y="2" class="body">${title}</text>
        <text x="400" y="2" class="muted">${age}</text>
      </g>`
    )
    .join('')
  return svg(`
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#101315"/>
    <rect width="68" height="${HEIGHT}" fill="#181d20"/>
    ${brandMark(15, 24, 38)}
    <rect x="68" width="500" height="${HEIGHT}" fill="#15191c"/>
    <line x1="568" x2="568" y2="${HEIGHT}" stroke="#30383d"/>
    <text x="94" y="46" class="section">SESSIONS</text>
    <text x="94" y="94" class="strong">Current Workspace</text>
    <text x="512" y="94" class="muted">4</text>
    <text x="110" y="140" class="body">reup</text>
    <text x="470" y="140" class="muted">11 sessions</text>
    ${rows}
    <text x="94" y="432" class="strong">Needs Attention Elsewhere</text>
    <text x="512" y="432" class="muted">2</text>
    <text x="94" y="488" class="strong">Recent Elsewhere</text>
    <text x="512" y="488" class="muted">8</text>
    <text x="606" y="46" class="section">SESSION INSPECTOR</text>
    <text x="606" y="94" class="h1">Fix release blocker</text>
    <rect x="606" y="122" width="636" height="82" rx="10" fill="#20272b"/>
    <rect x="606" y="122" width="4" height="82" fill="#47d7a1"/>
    <text x="628" y="151" class="strong">Ready to resume</text>
    <text x="628" y="178" class="muted">The project path and branch context are consistent.</text>
    <rect x="606" y="226" width="102" height="38" rx="8" fill="${brand.color}"/>
    <text x="627" y="251" class="buttonStrong">Resume</text>
    <rect x="720" y="226" width="132" height="38" rx="8" fill="#20272b" stroke="#39444a"/>
    <text x="740" y="251" class="button">Copy handoff</text>
    <rect x="864" y="226" width="78" height="38" rx="8" fill="#20272b" stroke="#39444a"/>
    <text x="884" y="251" class="button">Tags</text>
    <text x="606" y="318" class="section">WHAT YOU ASKED FOR</text>
    <text x="606" y="352" class="body">Verify the release path and remove the final blocker.</text>
    <text x="606" y="408" class="section">WHERE CLAUDE LEFT OFF</text>
    <text x="606" y="442" class="body">Implementation is complete and the test suite is green.</text>
    <text x="606" y="468" class="body">Package the extension and run a clean-host smoke test.</text>
    <text x="606" y="524" class="section">PLAN · CLAUDE PLAN · 12M AGO</text>
    <text x="606" y="558" class="body">✓ Validate the dashboard workflow</text>
    <text x="606" y="586" class="body">✓ Run extension regression tests</text>
    <text x="606" y="614" class="body">○ Verify the packaged VSIX</text>
  `)
}

function sessionRow(title, meta, branch, index, selected) {
  const y = 154 + index * 104
  return `
    <g transform="translate(254 ${y})">
      ${index === selected ? '<rect width="488" height="88" rx="10" fill="#20272b" stroke="#334149"/>' : ''}
      <circle cx="18" cy="26" r="5" fill="${index === 0 ? '#47d7a1' : '#667078'}"/>
      <text x="38" y="30" class="strong">${title}</text>
      <text x="38" y="56" class="muted">${meta}</text>
      <text x="380" y="56" class="tag">${branch}</text>
    </g>`
}

function emptyDetail() {
  return `
    <text x="790" y="156" class="section">SESSION INTELLIGENCE</text>
    <text x="790" y="204" class="h1">Know where Claude stopped.</text>
    <text x="790" y="246" class="body">Select any session to inspect its goal, latest answer,</text>
    <text x="790" y="274" class="body">plan, TODOs, files, branch state and resume safety.</text>
    <rect x="790" y="320" width="420" height="140" rx="12" fill="#171d20" stroke="#2c353a"/>
    <text x="816" y="356" class="section">ZERO GUESSWORK</text>
    <text x="816" y="395" class="strong">Resume the right thread, not the newest one.</text>
    <text x="816" y="429" class="muted">Everything stays local. Transcripts remain untouched.</text>`
}

function resumeButtons(stage) {
  return `
    <rect x="790" y="334" width="118" height="42" rx="8" fill="${brand.color}"/>
    <text x="816" y="361" class="buttonStrong">Resume</text>
    <rect x="908" y="334" width="34" height="42" fill="${brand.colorDeep}"/>
    <text x="919" y="361" class="buttonStrong">⌄</text>
    ${
      stage === 'resume'
        ? `<rect x="898" y="382" width="270" height="116" rx="10" fill="#20272b" stroke="#435058"/>
           <text x="920" y="416" class="strong">Claude Code Extension</text>
           <text x="920" y="449" class="body">VS Code Terminal</text>
           <line x1="912" y1="464" x2="1154" y2="464" stroke="#354046"/>
           <text x="920" y="488" class="muted">✓ Remember my choice</text>`
        : `<rect x="958" y="334" width="124" height="42" rx="8" fill="#20272b" stroke="#39444a"/>
           <text x="980" y="361" class="button">Copy handoff</text>`
    }`
}

function brandMark(x, y, size) {
  return `
    <g transform="translate(${x} ${y}) scale(${size / 256})">
      <rect width="256" height="256" rx="52" fill="${brand.colorDeep}"/>
      <path fill="${brand.color}" d="${brand.path}"/>
      <path fill="${brand.colorMid}" d="${brand.accentPath}"/>
    </g>`
}

function cursor(x, y) {
  return `<circle cx="${x}" cy="${y}" r="14" fill="#fff" opacity=".16"/>
    <circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="${brand.color}" stroke-width="3"/>`
}

function svg(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <style>
      text{font-family:Segoe UI,Inter,Arial,sans-serif}.brand{fill:#f4f6f7;font-size:25px;font-weight:750}
      .subtitle{fill:${brand.colorMid};font-size:12px;font-style:italic;font-weight:650;letter-spacing:1.4px}
      .h1{fill:#f4f6f7;font-size:27px;font-weight:750}.strong{fill:#eef1f3;font-size:16px;font-weight:650}
      .body{fill:#d0d6da;font-size:15px}.muted{fill:#89949b;font-size:14px}
      .section,.eyebrow{fill:#8d989f;font-size:12px;font-weight:700;letter-spacing:1.2px}
      .eyebrow,.tag,.link{fill:${brand.color}}.tag,.link{font-size:13px}.button{fill:#dbe1e4;font-size:13px}
      .buttonStrong{fill:#fff;font-size:13px;font-weight:700}.caption{fill:#e7ecef;font-size:16px;font-weight:600}
      .good{fill:#47d7a1;font-size:16px}.warn{fill:#f0b85a;font-size:16px}
    </style>${content}</svg>`
}
