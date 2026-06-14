import Sidebar from '../components/Sidebar'

const PLUGINS = [
  {
    name: 'Salesforce',
    version: 'v4.2.1',
    icon: 'cloud_sync',
    description: 'Ingests and synchronizes client intelligence, deal progression, and historical interaction data to construct predictive revenue models.',
    tags: ['CRM Integration', 'Sales Ops', 'Revenue Forecasting'],
    connectionString: 'int::salesforce.com/api/v4',
  },
  {
    name: 'Confluence',
    version: 'v2.1.0',
    icon: 'menu_book',
    description: 'Scrapes and semantically indexes operational documentation, runbooks, and internal wikis to enrich agent knowledgebase.',
    tags: ['Knowledge Matrix', 'Ops Manuals', 'Project Documentation'],
    connectionString: 'int::confluence.atlassian',
  },
  {
    name: 'Notion',
    version: 'v1.8.5',
    icon: 'description',
    description: 'Extracts unstructured meeting notes, project metadata, and ad-hoc strategic planning documents for synthesis.',
    tags: ['Strategic Workspace', 'Team Wiki', 'Asset Tracking'],
    connectionString: 'int::notion.so/api',
  },
  {
    name: 'Google Workspace',
    version: 'v5.0.0',
    icon: 'workspaces',
    description: 'Deep indexing of organizational communications, calendar events, and drive assets for comprehensive entity mapping.',
    tags: ['Global Workspace', 'Data Storage', 'Unified Search'],
    connectionString: 'int::workspace.google',
  },
  {
    name: 'Slack',
    version: 'v3.3.2',
    icon: 'forum',
    description: 'Real-time monitoring of designated channels for actionable signals, sentiment shifts, and tactical team chatter.',
    tags: ['Comms Relay', 'Real-time Alerts', 'Bot Notifications'],
    connectionString: 'int::api.slack.com',
  },
  {
    name: 'Jira',
    version: 'v2.9.1',
    icon: 'bug_report',
    description: 'Aligns engineering velocity and development sprints with overarching strategic objectives and risk models.',
    tags: ['Task Tracking', 'Sprint Planning', 'Velocity Monitoring'],
    connectionString: 'int::jira.atlassian.com',
  },
]

function PluginCard({ name, version, icon, description, tags, connectionString }) {
  return (
    <article className="group relative bg-surface-container-high border border-outline-variant rounded-xl p-8 flex flex-col h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-primary-container hover:shadow-[0_0_30px_rgba(255,84,76,0.1)] cursor-pointer">
      <div className="scanline-effect absolute inset-0 pointer-events-none" />

      {/* Header */}
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-outline-variant group-hover:border-primary-container transition-colors">
          <span className="material-symbols-outlined text-primary-container text-2xl">{icon}</span>
        </div>
        <span className="text-[11px] px-2 py-1 bg-surface border border-outline-variant text-on-surface-variant rounded uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {version}
        </span>
      </div>

      {/* Content */}
      <h3 className="text-on-surface mb-2 group-hover:text-primary-container transition-colors font-semibold" style={{ fontFamily: 'Syne, sans-serif', fontSize: '1.1rem' }}>
        {name}
      </h3>
      <p className="text-sm text-on-surface-variant mb-4 leading-relaxed">{description}</p>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tags.map((tag, idx) => (
          <span key={idx} className="text-[10px] text-primary-container uppercase border border-primary-container/30 px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-auto relative z-10 flex flex-col gap-3">
        <button className="w-full bg-primary-container text-on-primary-container text-[11px] py-2 rounded uppercase tracking-widest hover:bg-primary transition-colors" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          CONNECT PLUGIN
        </button>
        <div className="text-[10px] text-on-surface-variant/70 flex items-center gap-2 justify-center" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          <span className="material-symbols-outlined text-xs">link</span>
          {connectionString}
        </div>
      </div>
    </article>
  )
}

export default function PluginsPage() {
  return (
    <div className="bg-surface-container-lowest text-on-surface relative min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="fixed inset-0 pointer-events-none bg-grid-pattern opacity-40 z-0" />
      <Sidebar />

      <main className="flex-grow ml-64 p-8 md:p-16 min-h-screen relative z-10">
        {/* Header */}
        <header className="mb-16 border-b border-outline-variant pb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-2 h-2 bg-primary-container rounded-full animate-pulse" />
              <span className="text-[11px] text-primary-container uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Live Repository</span>
            </div>
            <h1 className="font-bold text-on-surface uppercase tracking-tighter" style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem' }}>
              Plugins Directory
            </h1>
          </div>
          <div className="flex items-center gap-4 border border-outline-variant rounded-full px-4 py-2 bg-surface-container-high/50 backdrop-blur-sm">
            <span className="material-symbols-outlined text-on-surface-variant text-sm">search</span>
            <input
              className="bg-transparent border-none outline-none text-on-surface placeholder-on-surface-variant w-48"
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}
              placeholder="QUERY PLUGINS..."
              type="text"
            />
          </div>
        </header>

        {/* Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PLUGINS.map((plugin, idx) => (
            <PluginCard key={idx} {...plugin} />
          ))}
        </section>
      </main>
    </div>
  )
}
