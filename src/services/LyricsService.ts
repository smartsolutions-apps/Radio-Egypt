import { GoogleGenAI } from "@google/genai";

export class LyricsService {
  private static ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  static async getNowPlayingAndLyrics(stationName: string): Promise<{ artist: string; title: string; lyrics: string } | null> {
    try {
      // Step 1: Find what's playing using Google Search grounding
      const searchResponse = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `What is currently playing on "${stationName}" radio station right now? Please provide the artist name and song title. If you can't find the real-time info, try to find the most recent song played.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const infoText = searchResponse.text;
      
      // Step 2: Extract artist and title and get lyrics
      const lyricsResponse = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on this information: "${infoText}", identify the artist and song title. Then, find and provide the full lyrics for that song. 
        Format your response as a JSON object with keys: "artist", "title", and "lyrics". 
        The "lyrics" should be formatted with newlines for display.`,
        config: {
          responseMimeType: "application/json",
        }
      });

      const result = JSON.parse(lyricsResponse.text);
      return result;
    } catch (error) {
      console.error("Error fetching lyrics:", error);
      return null;
    }
  }

  static async searchLyrics(artist: string, title: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find the lyrics for the song "${title}" by "${artist}". Provide only the lyrics text.`,
      });
      return response.text;
    } catch (error) {
      console.error("Error searching lyrics:", error);
      return null;
    }
  }
}
