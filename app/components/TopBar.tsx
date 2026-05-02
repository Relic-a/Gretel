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
          Home
        </button>
        <button type="button" className={props.activeSection === "saved" ? "active" : ""} onClick={props.onSaved}>
          Saved
        </button>
        <button type="button" className={props.activeSection === "history" ? "active" : ""} onClick={props.onHistory}>
          History
        </button>
      </nav>
      <div className="profile-menu">
        <button type="button" className="profile-button" onClick={props.onToggleProfileMenu}>
          {props.activeProfile?.name || "Profile"}
        </button>
        {props.showProfileMenu && (
          <div className="profile-popover">
            {props.profiles.map((profile) => (
              <button type="button" key={profile.id} onClick={() => props.onSelectProfile(profile.id)}>
                {profile.name}
              </button>
            ))}
            <button type="button" onClick={props.onManageProfiles}>
              Manage profiles
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
