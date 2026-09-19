import Link from "next/link";

import { GretelMark } from "./brand-marks";
import { RELEASES_URL, ISSUES_URL } from "./landing-data";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <GretelMark size={24} />
          <div>
            <strong>Gretel</strong>
            <p>A local-first YouTube feed curator by Ezana.</p>
          </div>
        </div>

        <nav className="site-footer-links" aria-label="Footer">
          <div>
            <h2>Legal</h2>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
          <div>
            <h2>Project</h2>
            <a href={RELEASES_URL} rel="noreferrer">Releases</a>
            <a href={ISSUES_URL} rel="noreferrer">Report an issue</a>
            <a href="https://github.com/Relic-a/Gretel" rel="noreferrer">Source code</a>
          </div>
        </nav>
      </div>

      <div className="site-footer-base">
        <span>© {new Date().getFullYear()} Ezana. All rights reserved.</span>
        <span>Gretel is not affiliated with, endorsed by, or sponsored by YouTube or Google.</span>
      </div>
    </footer>
  );
}
