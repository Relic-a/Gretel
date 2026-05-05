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
};

export function TopBar(props: TopBarProps) {
  return (
    <header className="topbar">
      <button type="button" className="brand-button" onClick={props.onHome}>
        Gretel
      </button>
      <nav className="section-tabs" aria-label="Video sections">
        <button type="button" className={props.activeSection === "home" ? "active" : ""} onClick={props.onHome}>
          <span aria-hidden="true">⌂</span> Home
        </button>
        <button type="button" onClick={props.onHome}>
          <span aria-hidden="true">⌖</span> Explore
        </button>
        <button type="button" className={props.activeSection === "saved" ? "active" : ""} onClick={props.onSaved}>
          <span aria-hidden="true">□</span> Saved
        </button>
        <button type="button" className={props.activeSection === "history" ? "active" : ""} onClick={props.onHistory}>
          <span aria-hidden="true">↺</span> History
        </button>
      </nav>
      <div className="profile-menu">
        <button type="button" className="profile-button" onClick={props.onToggleProfileMenu}>
          <span className="profile-avatar" aria-hidden="true" />
          {props.activeProfile?.name || "Select profile"}
          <span aria-hidden="true">⌄</span>
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
              <span className="manage-icon" aria-hidden="true">⚙</span>
              Manage profiles
            </button>
          </div>
        )}
      </div>
      <div className="topbar-icons" aria-hidden="true">
        <span>♧</span>
        <span>☰</span>
      </div>
    </header>
  );
}
