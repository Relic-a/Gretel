import type { Profile } from "../types";

type TopBarProps = {
  activeProfile?: Profile;
  profiles: Profile[];
  showProfileMenu: boolean;
  onHome: () => void;
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
