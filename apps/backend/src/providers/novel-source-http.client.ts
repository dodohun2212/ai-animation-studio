/** Low-level network adapter for public novel catalogs and text mirrors. */
export class NovelSourceHttpClient {
  request(url: URL, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}
