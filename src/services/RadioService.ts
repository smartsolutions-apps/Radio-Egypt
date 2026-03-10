export interface RadioStation {
  changeuuid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  votes: number;
  lastchangetime: string;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  lastchecktime: string;
  lastcheckoktime: string;
  lastlocalchecktime: string;
  clickcount: number;
  clickday: number;
  clicktrend: number;
  // Derived field
  frequency?: number;
}

export class RadioService {
  private static BASE_URL = 'https://de1.api.radio-browser.info/json';

  private static extractFrequency(name: string): number | undefined {
    const match = name.match(/(\d{1,3}\.\d)/);
    return match ? parseFloat(match[1]) : undefined;
  }

  static async getTopStations(limit = 50): Promise<RadioStation[]> {
    const response = await fetch(`${this.BASE_URL}/stations/topvote/${limit}`);
    const data: RadioStation[] = await response.json();
    return data.map(s => ({ ...s, frequency: this.extractFrequency(s.name) }));
  }

  static async searchStations(params: {
    name?: string;
    country?: string;
    state?: string;
    tag?: string;
    limit?: number;
  }): Promise<RadioStation[]> {
    const query = new URLSearchParams();
    if (params.name) query.append('name', params.name);
    if (params.country) query.append('country', params.country);
    if (params.state) query.append('state', params.state);
    if (params.tag) query.append('tag', params.tag);
    query.append('limit', (params.limit || 100).toString());
    query.append('hidebroken', 'true');
    query.append('order', 'votes');
    query.append('reverse', 'true');

    const response = await fetch(`${this.BASE_URL}/stations/search?${query.toString()}`);
    const data: RadioStation[] = await response.json();
    return data.map(s => ({ ...s, frequency: this.extractFrequency(s.name) }));
  }

  static async getStationsByCountryCode(code: string, limit = 100): Promise<RadioStation[]> {
    const response = await fetch(`${this.BASE_URL}/stations/bycountrycodeexact/${code}?limit=${limit}&hidebroken=true&order=votes&reverse=true`);
    const data: RadioStation[] = await response.json();
    return data.map(s => ({ ...s, frequency: this.extractFrequency(s.name) }));
  }
}
