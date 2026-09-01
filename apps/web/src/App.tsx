import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ArrowUpRight, Check, Clipboard, Github, Moon, Network, Sun, TerminalSquare, TrainFront } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getConfig } from "./api";
import { Showcase } from "./Showcase";

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
        <nav aria-label="Primary navigation"><a href="#install">Install</a><a href="#demo">Live lookup</a></nav>
        <div className="header-actions">
          <button className="icon-button" onClick={toggleTheme} aria-label={dark ? "Use light mode" : "Use dark mode"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <a className="github-button" href={githubUrl ?? "https://github.com/new"} target="_blank" rel="noreferrer"><Github size={16} />{githubUrl ? "GitHub" : "Publish repo"}<ArrowUpRight size={14} /></a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="status-line">Local Houston METRO MCP</p>
            <h1>Houston METRO transit data</h1>
            <p className="hero-lead">Look up routes, stops, live arrivals, and service alerts from your local MCP client.</p>
            <div className="hero-actions"><a className="primary-link" href="#install"><TerminalSquare size={17} />Install the MCP</a><a className="secondary-link" href="#demo">Open live lookup</a></div>
            <div className="hero-meta"><span><Check size={14} />Typed responses</span><span><Check size={14} />Your own API key</span><span><Check size={14} />Local stdio</span></div>
          </div>
          <div id="demo"><Showcase /></div>
        </section>

        <section className="proof-strip" aria-label="Project capabilities">
          <div><TerminalSquare size={18} /><span><strong>Runs locally</strong><small>Your MCP client starts it</small></span></div>
          <div><Network size={18} /><span><strong>Official METRO data</strong><small>Routes, stops, arrivals, and alerts</small></span></div>
        </section>

        <section className="content-section install-section" id="install">
          <div className="section-heading"><div><p className="eyebrow">Installation</p><h2>Connect the local MCP.</h2><p>After cloning and building the project, add its local command to your MCP client.</p></div></div>
          <Tabs.Root className="install-tabs" defaultValue="claude">
            <Tabs.List className="tab-list" aria-label="MCP client configuration"><Tabs.Trigger value="claude">Claude Desktop</Tabs.Trigger><Tabs.Trigger value="cursor">Cursor</Tabs.Trigger></Tabs.List>
            <Tabs.Content value="claude"><CodePanel value={snippets.claude} /><p className="config-note">Add this object to Claude Desktop’s MCP configuration, then restart the app.</p></Tabs.Content>
            <Tabs.Content value="cursor"><CodePanel value={snippets.cursor} /><p className="config-note">Add this local command to your project or global Cursor MCP configuration.</p></Tabs.Content>
          </Tabs.Root>
        </section>

      </main>

      <footer>
        <div className="footer-brand"><span className="brand-mark"><TrainFront size={16} /></span><span><strong>Houston METRO MCP</strong><small>Independent open-source integration</small></span></div>
        <div className="legal"><p>Route and arrival data provided by permission of METRO</p><p>* METRO is the registered trademark of the Metropolitan Transit Authority of Harris County, Texas.</p></div>
        <div className="footer-links">
          <a href="https://api-portal.ridemetro.org/" target="_blank" rel="noreferrer">Official data portal <ArrowUpRight size={13} /></a>
          <a href="https://harunsufi.me" target="_blank" rel="noreferrer">harunsufi.me <ArrowUpRight size={13} /></a>
        </div>
      </footer>
    </div>
  );
}
