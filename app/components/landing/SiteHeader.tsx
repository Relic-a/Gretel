import Link from "next/link";

import { GretelMark, GithubMark } from "./brand-marks";
import { RELEASES_URL } from "./landing-data";

const links = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#install", label: "Install" },
  { href: "#requirements", label: "Requirements" }
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/" aria-label="Gretel home">
          <GretelMark size={26} />
          <span>Gretel</span>
        </Link>

        <nav className="site-nav" aria-label="Primary">
          {links.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
        </nav>

        <div className="site-header-actions">
          <a className="ghost-link" href={RELEASES_URL} rel="noreferrer">
            <GithubMark size={16} />
            <span>GitHub</span>
          </a>
          <a className="button small" href="#install">Download</a>
        </div>
      </div>
    </header>
  );
}
