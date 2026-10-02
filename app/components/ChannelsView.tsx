import { useState } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw, Search, Tv, X } from "lucide-react";
import type { ChannelResult } from "../types";

export function ChannelsView(props: { channels: string[]; knownChannels: ChannelResult[]; onOpen: (channel: ChannelResult) => void }) {
  const [search, setSearch] = useState("");
  const channels = props.channels.map(name => props.knownChannels.find(item =>
    item.name.toLowerCase() === name.toLowerCase() || item.id === name) || { id: "", name });
  const visible = channels.filter(channel => channel.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="feed-view channels-view">
    <div className="feed-heading channel-directory-heading">
      <div><h1>Channels <span className="channel-count">{channels.length}</span></h1><p>Browse your subscriptions, one channel at a time.</p></div>
      {channels.length > 0 && <div className="feed-search" role="search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a channel" aria-label="Find a subscribed channel" />
        {search && <button type="button" className="feed-search-clear" aria-label="Clear channel search" onClick={() => setSearch("")}><X size={16} /></button>}
      </div>}
    </div>
    {channels.length === 0 ? <div className="channel-empty"><Tv size={32} aria-hidden="true" /><h2>Your channels will appear here</h2><p>Subscribe from a video or add channels in Manage profiles.</p></div> :
      visible.length === 0 ? <div className="channel-empty"><Search size={28} aria-hidden="true" /><h2>No matching channels</h2><p>Try another name or clear your search.</p><button type="button" className="action-button" onClick={() => setSearch("")}>Show all channels</button></div> :
      <div className="channel-directory">{visible.map(channel => <button type="button" key={channel.id || channel.name} className="channel-directory-item" onClick={() => props.onOpen(channel)}>
        <ChannelAvatar channel={channel} /><span className="channel-directory-copy"><strong>{channel.name}</strong><span>Browse videos</span></span><ArrowUpRight className="channel-directory-arrow" size={18} aria-hidden="true" />
      </button>)}</div>}
  </section>;
}

export function ChannelHeading(props: { channel: ChannelResult; sorts: string[]; sort: string; filter: boolean; loading: boolean;
  onBack: () => void; onSort: (sort: string) => void; onFilter: (filter: boolean) => void; onRefresh: () => void }) {
  return <div className="channel-heading feed-view">
    <div className="channel-navigation">
      <button type="button" className="channel-back" onClick={props.onBack}><ArrowLeft size={16} aria-hidden="true" /> All channels</button>
      <button type="button" className="channel-refresh" disabled={props.loading} onClick={props.onRefresh} aria-label="Refresh channel videos"><RefreshCw size={16} className={props.loading ? "spinner" : undefined} aria-hidden="true" /> Refresh</button>
    </div>
    <div className="channel-heading-row"><div className="channel-identity"><ChannelAvatar channel={props.channel} /><div><h1>{props.channel.name}</h1><p>Channel videos</p></div></div></div>
    <div className="channel-toolbar">
      <div className="channel-sorts" role="group" aria-label="Sort channel videos">
        {(props.sorts.length ? props.sorts : ["Newest"]).map((sort, index) => <button type="button" key={sort}
          aria-pressed={props.sort === sort || (!props.sort && index === 0)} disabled={props.loading || !props.sorts.length}
          onClick={() => props.onSort(index === 0 ? "" : sort)}>{sort}</button>)}
      </div>
      <label className="channel-filter"><input type="checkbox" role="switch" checked={props.filter} onChange={event => props.onFilter(event.target.checked)} /><span className="channel-switch-track" aria-hidden="true" /><span>Filter by my interests</span></label>
    </div>
    <p className="channel-filter-copy" role="status">{props.filter ? "Showing videos that match this profile’s interests." : "Showing all channel videos. Interest filtering is off."}</p>
  </div>;
}

function ChannelAvatar({ channel }: { channel: ChannelResult }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  return <span className="avatar large channel-avatar" aria-hidden="true">
    <span>{channel.name.slice(0, 1).toUpperCase()}</span>
    {channel.thumbnailUrl && failedUrl !== channel.thumbnailUrl && <img src={channel.thumbnailUrl} alt="" loading="lazy" onError={() => setFailedUrl(channel.thumbnailUrl)} />}
  </span>;
}
