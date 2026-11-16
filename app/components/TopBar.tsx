import { useEffect, useRef, useState } from "react";
import { Activity, Bookmark, ChevronDown, History, Home, ListVideo, Loader2, RefreshCw, Search, Settings, Users } from "lucide-react";

import { profileInitials } from "./profile-identity";
import type { Profile } from "../types";
import { usePopoverDismissal } from "./use-popover-dismissal";

type TopBarProps = {
  activeProfile?: Profile;
  profiles: Profile[];
  activeSection: "home" | "saved" | "history" | "channels";
  showProfileMenu: boolean;
  developerAnalytics: boolean;
  searchQuery: string;
  searching: boolean;
  refreshing: boolean;
  onHome: () => void;
  onSaved: () => void;
  onHistory: () => void;
  onChannels: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearch: (event: React.FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onToggleProfileMenu: () => void;
  onSelectProfile: (profileId: string) => void;
  onManageProfiles: () => void;
  onOpenSettings: () => void;
  queueCount: number;
  queueOpen: boolean;
  onToggleQueue: () => void;
  onCloseProfileMenu: () => void;
};

export function TopBar(props: TopBarProps) {
  const [isReady, setIsReady] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  usePopoverDismissal(profileMenuRef, () => {
    props.onCloseProfileMenu();
    if (profileMenuRef.current?.contains(document.activeElement)) {
      profileMenuRef.current.querySelector<HTMLButtonElement>(".profile-button")?.focus();
    }
  }, props.showProfileMenu);

  useEffect(() => {
    // Only render full UI on client to prevent hydration errors.
    setIsReady(true);
  }, []);

  if (!isReady) return null;

  const renderNavigation = (mobile: boolean) => (
      <nav className={`section-tabs ${mobile ? "mobile-tabs" : "desktop-tabs"}`} aria-label="Video sections">
        <button type="button" aria-current={props.activeSection === "home" ? "page" : undefined} className={props.activeSection === "home" ? "active" : ""} onClick={props.onHome}>
          <Home aria-hidden="true" size={18} /> Home
        </button>
        <button type="button" aria-current={props.activeSection === "channels" ? "page" : undefined} className={props.activeSection === "channels" ? "active" : ""} onClick={props.onChannels}>
          <Users aria-hidden="true" size={18} /> Channels
        </button>
        <button type="button" aria-current={props.activeSection === "saved" ? "page" : undefined} className={props.activeSection === "saved" ? "active" : ""} onClick={props.onSaved}>
          <Bookmark aria-hidden="true" size={18} /> Saved
        </button>
        <button type="button" aria-current={props.activeSection === "history" ? "page" : undefined} className={props.activeSection === "history" ? "active" : ""} onClick={props.onHistory}>
          <History aria-hidden="true" size={18} /> History
        </button>
      </nav>
  );

  return (
    <>
    <header className="topbar">
      <button type="button" className="brand-button" onClick={props.onHome}>
        Gretel
      </button>
      {renderNavigation(false)}
      <form className="topbar-search" role="search" onSubmit={props.onSearch}>
        {props.searching ? (
          <Loader2 aria-hidden="true" size={17} className="spin" />
        ) : (
          <Search aria-hidden="true" size={17} />
        )}
        <input
          type="search"
          value={props.searchQuery}
          onChange={(event) => props.onSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              props.onSearchQueryChange("");
            }
          }}
          placeholder="Search videos"
          aria-label="Search videos"
        />
      </form>
      <div className="topbar-actions">
        <button type="button" data-queue-trigger aria-label={`Open queue, ${props.queueCount} videos`} className={props.queueOpen ? "queue-topbar-button active" : "queue-topbar-button"} onClick={props.onToggleQueue} aria-expanded={props.queueOpen} aria-controls="global-queue" title="Open queue">
          <ListVideo aria-hidden="true" size={18} /> <span className="queue-topbar-label">Queue</span>{props.queueCount > 0 && <span className="queue-topbar-count">{props.queueCount}</span>}
        </button>
        <button
          type="button"
          className="settings-button refresh-button"
          onClick={props.onRefresh}
          aria-label="Refresh videos"
          title="Refresh videos (Ctrl+R)"
          disabled={props.refreshing || props.searching}
        >
          <RefreshCw aria-hidden="true" size={18} className={props.refreshing ? "spin" : undefined} />
        </button>
        {props.developerAnalytics && (
          <a className="settings-button" href="/diagnostics" aria-label="Open performance diagnostics" title="Performance diagnostics">
            <Activity aria-hidden="true" size={18} />
          </a>
        )}
        <button type="button" className="settings-button" onClick={props.onOpenSettings} aria-label="Open settings">
          <Settings aria-hidden="true" size={18} />
        </button>
        <div ref={profileMenuRef} className="profile-menu">
          <button type="button" aria-expanded={props.showProfileMenu} aria-controls="profile-picker" aria-label={`Current profile: ${props.activeProfile?.name || "Select profile"}`} className="profile-button" onClick={props.onToggleProfileMenu} title={props.activeProfile?.name || "Select profile"}>
            <span className="profile-avatar" aria-hidden="true">{profileInitials(props.activeProfile?.name)}</span>
            <span className="profile-button-name">{props.activeProfile?.name || "Select profile"}</span>
            <ChevronDown aria-hidden="true" size={17} className="profile-chevron" />
          </button>
          {props.showProfileMenu && (
            <div className="profile-popover" id="profile-picker" aria-label="Choose a profile">
              {props.profiles.map((profile) => (
                <button type="button" key={profile.id} aria-current={profile.id === props.activeProfile?.id ? "true" : undefined} title={profile.name} onClick={() => { props.onSelectProfile(profile.id); profileMenuRef.current?.querySelector<HTMLButtonElement>(".profile-button")?.focus(); }}>
                  <span className="profile-avatar small" aria-hidden="true">{profileInitials(profile.name)}</span>
                  <span className="profile-option-name">{profile.name}</span>
                  {profile.id === props.activeProfile?.id && <span className="selected-mark" aria-hidden="true">✓</span>}
                </button>
              ))}
              <button type="button" onClick={props.onManageProfiles}>
                <Settings className="manage-icon" aria-hidden="true" size={18} />
                Manage profiles
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    {renderNavigation(true)}
    </>
  );
}
