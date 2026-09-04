// Keep only one raw page ahead. Embedding work starts when the reader asks for more.
export class SearchPager<T extends { id: string }, P> {
  private seen = new Set<string>();
  private pending?: Promise<P | null>;
  private pages = new Map<number, Promise<{ videos: T[]; hasMore: boolean }>>();

  constructor(
    private first: () => Promise<P>,
    private next: (page: P) => Promise<P | null>,
    private candidates: (page: P) => Promise<T[]>,
    private filter: (videos: T[]) => Promise<{ videos: T[]; reliable: boolean }>,
    private hasNext: (page: P) => boolean
  ) {}

  getPage(index: number) {
    const cached = this.pages.get(index);
    if (cached) return cached;
    if (index !== this.pages.size) throw new Error("Invalid search page");
    const result = index === 0 ? this.load(index) : this.pages.get(index - 1)!.then(
      (previous) => previous.hasMore ? this.load(index) : { videos: [], hasMore: false }
    );
    this.pages.set(index, result);
    void result.catch(() => this.pages.delete(index));
    return result;
  }

  private async load(index: number) {
    let page = index === 0 ? await this.first() : await this.pending;
    if (page == null) return { videos: [], hasMore: false };
    const raw = await this.candidates(page);
    if (index === 0 && this.hasNext(page)) {
      const second = await this.next(page);
      if (second != null) {
        page = second;
        raw.push(...await this.candidates(second));
      }
    }
    const unique = raw.filter((video) => {
      if (this.seen.has(video.id)) return false;
      this.seen.add(video.id);
      return true;
    });
    let result;
    try {
      result = await this.filter(unique);
    } catch (error) {
      for (const video of unique) this.seen.delete(video.id);
      throw error;
    }
    const hasMore = result.reliable && unique.length > 0 &&
      result.videos.length / unique.length >= 0.25 && this.hasNext(page);
    // Catch speculative fetch failures immediately; the visible results remain usable.
    this.pending = hasMore ? this.next(page).catch(() => null) : undefined;
    return { videos: result.videos, hasMore };
  }
}
