import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ArrowUpRight, Check, Clipboard, Github, Moon, Network, Server, Sun, TerminalSquare, TrainFront } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getConfig } from "./api";
import { Showcase } from "./Showcase";

const tools = [
  ["search_routes", "Find bus or rail routes by number or name."],
  ["search_stops", "Resolve stop names and public stop codes to GTFS IDs."],
  ["find_nearby_stops", "Rank physical stops nearest to a coordinate."],
  ["get_next_arrivals", "Read current GTFS Realtime predictions for a stop."],
  ["get_service_alerts", "Return system-wide or exact-route disruptions."],
] as const;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button className="copy-button" type="button" onClick={() => void copy()} aria-label="Copy configuration">
            {copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy"}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={8}>{copied ? "Copied to clipboard" : "Copy JSON"}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function CodePanel({ value }: { value: string }) {
  return <div className="code-panel"><CopyButton value={value} /><pre><code>{value}</code></pre></div>;
}

export function App() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [githubUrl, setGithubUrl] = useState<string | null>(import.meta.env.VITE_GITHUB_URL || null);

  useEffect(() => {
    void getConfig().then((config) => { if (config.githubUrl) setGithubUrl(config.githubUrl); }).catch(() => undefined);
  }, []);

  const snippets = useMemo(() => ({
    claude: JSON.stringify({ mcpServers: { "houston-metro": { command: "node", args: ["C:/path/to/metro-mcp/apps/cli/dist/index.js"], env: { METRO_GTFS_API_KEY: "YOUR_METRO_API_KEY" } } } }, null, 2),
    cursor: JSON.stringify({ mcpServers: { "houston-metro": { command: "node", args: ["C:/path/to/metro-mcp/apps/cli/dist/index.js"], env: { METRO_GTFS_API_KEY: "YOUR_METRO_API_KEY" } } } }, null, 2),
  }), []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("metro-theme", next ? "dark" : "light");
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Houston METRO MCP home"><span className="brand-mark"><TrainFront size={17} /></span><span>Houston METRO <em>MCP</em></span></a>
        <nav aria-label="Primary navigation"><a href="#install">Install</a><a href="#tools">Tools</a><a href="#demo">Live demo</a></nav>
        <div className="header-actions">
          <button className="icon-button" onClick={toggleTheme} aria-label={dark ? "Use light mode" : "Use dark mode"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <a className="github-button" href={githubUrl ?? "https://github.com/new"} target="_blank" rel="noreferrer"><Github size={16} />{githubUrl ? "GitHub" : "Publish repo"}<ArrowUpRight size={14} /></a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="status-line"><span className="status-dot" /> Open-source, read-only transit tools <span>•</span> Local MCP</div>
            <h1>Houston transit data,<br /><span>ready for your agent.</span></h1>
            <p className="hero-lead">Routes, stops, live arrivals, and service alerts through one small, typed MCP server. Built on official METRO data and designed to stay out of the way.</p>
            <div className="hero-actions"><a className="primary-link" href="#install"><TerminalSquare size={17} />Connect your client</a><a className="secondary-link" href="#demo">Try live arrivals<ArrowUpRight size={15} /></a></div>
            <div className="hero-meta"><span><Check size={14} />Typed responses</span><span><Check size={14} />Your own API key</span><span><Check size={14} />Local stdio</span></div>
          </div>
          <div id="demo"><Showcase /></div>
        </section>

        <section className="proof-strip" aria-label="Project capabilities">
          <div><TerminalSquare size={18} /><span><strong>Local MCP</strong><small>Runs with your agent</small></span></div>
          <div><Server size={18} /><span><strong>Independent demo</strong><small>The website is only a showcase</small></span></div>
          <div><Network size={18} /><span><strong>Three official feeds</strong><small>Catalog, realtime, alerts</small></span></div>
        </section>

        <section className="content-section install-section" id="install">
          <div className="section-heading"><span className="section-index">01</span><div><p className="eyebrow">Installation</p><h2>Connect in under a minute.</h2><p>Use the hosted endpoint directly, or let <code>mcp-remote</code> bridge clients that launch local processes.</p></div></div>
          <Tabs.Root className="install-tabs" defaultValue="claude">
            <Tabs.List className="tab-list" aria-label="MCP client configuration"><Tabs.Trigger value="claude">Claude Desktop</Tabs.Trigger><Tabs.Trigger value="cursor">Cursor</Tabs.Trigger></Tabs.List>
            <Tabs.Content value="claude"><CodePanel value={snippets.claude} /><p className="config-note">Add this object to Claude Desktop’s MCP configuration, then restart the app.</p></Tabs.Content>
            <Tabs.Content value="cursor"><CodePanel value={snippets.cursor} /><p className="config-note">Add this local command to your project or global Cursor MCP configuration.</p></Tabs.Content>
          </Tabs.Root>
        </section>

        <section className="content-section tools-section" id="tools">
          <div className="section-heading"><span className="section-index">02</span><div><p className="eyebrow">Tool surface</p><h2>Five focused operations.</h2><p>Small enough for a model to understand at a glance, complete enough for useful transit questions.</p></div></div>
          <div className="tool-grid">
            {tools.map(([name, description], index) => <article className="tool-card" key={name}><span className="tool-number">0{index + 1}</span><div><code>{name}</code><p>{description}</p></div><ArrowUpRight size={16} aria-hidden="true" /></article>)}
          </div>
        </section>

        <section className="content-section data-section">
          <div className="section-heading"><span className="section-index">03</span><div><p className="eyebrow">Data discipline</p><h2>Freshness is part of the answer.</h2><p>Every result says where it came from and when it was observed. Scheduled data is never presented as a live prediction.</p></div></div>
          <div className="data-cards">
            <article><span>01</span><h3>Static GTFS</h3><p>Routes and stops in a versioned D1 catalog with active service dates.</p></article>
            <article><span>02</span><h3>GTFS Realtime</h3><p>Arrival predictions include feed time, retrieval time, age, and a stale indicator.</p></article>
            <article><span>03</span><h3>V2 Alerts</h3><p>Normalized disruption details with exact affected route identifiers.</p></article>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-brand"><span className="brand-mark"><TrainFront size={16} /></span><span><strong>Houston METRO MCP</strong><small>Independent open-source integration</small></span></div>
        <div className="legal"><p>Route and arrival data provided by permission of METRO</p><p>* METRO is the registered trademark of the Metropolitan Transit Authority of Harris County, Texas.</p></div>
        <a href="https://api-portal.ridemetro.org/" target="_blank" rel="noreferrer">Official data portal <ArrowUpRight size={13} /></a>
      </footer>
    </div>
  );
}
