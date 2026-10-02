// Cache requested pages and coalesce duplicate requests; never fetch speculatively.
export class ChannelPager<T, P> {
  private pages = new Map<number, Promise<{ items: T[]; hasMore: boolean }>>();
  private current?: P;
  constructor(private first: () => Promise<P>, private next: (page: P) => Promise<P>,
    private items: (page: P) => T[], private hasNext: (page: P) => boolean) {}
  getPage(index: number): Promise<{ items: T[]; hasMore: boolean }> {
    const cached = this.pages.get(index);
    if (cached) return cached;
    if (index !== this.pages.size) throw new Error("Invalid channel page");
    const result = (async () => {
      if (index > 0) {
        const previous = await this.pages.get(index - 1)!;
        if (!previous.hasMore) return { items: [], hasMore: false };
      }
      const page = index === 0 ? await this.first() : await this.next(this.current!);
      const items = this.items(page);
      this.current = page;
      return { items, hasMore: this.hasNext(page) };
    })();
    this.pages.set(index, result);
    void result.catch(() => this.pages.delete(index));
    return result;
  }
}
