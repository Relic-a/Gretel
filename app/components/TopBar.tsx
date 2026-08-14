import { useEffect, useState } from "react";
import { Activity, Bookmark, ChevronDown, History, Home, Settings } from "lucide-react";

import type { Profile } from "../types";

type TopBarProps = {
  activeProfile?: Profile;
  profiles: Profile[];
  activeSection: "home" | "saved" | "history";
  showProfileMenu: boolean;
  onHome: () => void;
  onSaved: () => void;
  onHistory: () => void;
  onToggleProfileMenu: () => void;
  onSelectProfile: (profileId: string) => void;
  onManageProfiles: () => void;
  onOpenSettings: () => void;
};

export function TopBar(props: TopBarProps) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Only render full UI on client to prevent hydration errors.
    setIsReady(true);
  }, []);

  if (!isReady) return null;

  return (
    <header className="topbar">
      <button type="button" className="brand-button" onClick={props.onHome}>
        Gretel
      </button>
      <nav className="section-tabs" aria-label="Video sections">
        <button type="button" className={props.activeSection === "home" ? "active" : ""} onClick={props.onHome}>
          <Home aria-hidden="true" size={19} /> Home
        </button>
        <button type="button" className={props.activeSection === "saved" ? "active" : ""} onClick={props.onSaved}>
          <Bookmark aria-hidden="true" size={19} /> Saved
        </button>
        <button type="button" className={props.activeSection === "history" ? "active" : ""} onClick={props.onHistory}>
          <History aria-hidden="true" size={19} /> History
        </button>
      </nav>
      <div className="topbar-actions">
        <a className="settings-button" href="/diagnostics" aria-label="Open performance diagnostics" title="Performance diagnostics">
          <Activity aria-hidden="true" size={18} />
        </a>
        <button type="button" className="settings-button" onClick={props.onOpenSettings} aria-label="Open settings">
          <Settings aria-hidden="true" size={18} />
        </button>
        <div className="profile-menu">
          <button type="button" className="profile-button" onClick={props.onToggleProfileMenu}>
            <span className="profile-avatar" aria-hidden="true" />
            {props.activeProfile?.name || "Select profile"}
            <ChevronDown aria-hidden="true" size={17} />
          </button>
          {props.showProfileMenu && (
            <div className="profile-popover">
              {props.profiles.map((profile) => (
                <button type="button" key={profile.id} onClick={() => props.onSelectProfile(profile.id)}>
                  <span className="profile-avatar small" aria-hidden="true" />
                  {profile.name}
                  {profile.id === props.activeProfile?.id && <span className="selected-mark" aria-hidden="true">✓</span>}
                </button>
              ))}
              <button type="button" onClick={props.onManageProfiles}>
                <Settings className="manage-icon" aria-hidden="true" size={19} />
                Manage profiles
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
