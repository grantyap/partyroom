import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { browserReachableServiceUrl } from "$lib/service-url";
import {
  findKaraokeCue,
  lyricsIntoCues,
  parseLyricObservations,
  type KaraokeCue,
  type LyricsTrack,
} from "$lib/karaoke";

export type KaraokeLyricsStateOptions = {
  getLyrics: () => LyricsTrack[];
  getSelectedLyricsId: () => string | null | undefined;
  getLyricsOffsetMs: () => number | undefined;
  getCurrentTime: () => number;
};

function isUsableLyricsTrack(track: LyricsTrack) {
  return track.content.kind === "url"
    ? track.content.url.length > 0
    : track.content.observations.length > 0;
}

/**
 * Loads the selected lyrics track and derives the cue currently addressed by
 * the shared playback clock. Consumers can use the same state for overlays and
 * full-page lyric views.
 */
export class KaraokeLyricsState {
  #cues = $state<KaraokeCue[]>([]);
  #isLoading = $state(false);
  #error = $state<string | null>(null);

  constructor(private readonly options: KaraokeLyricsStateOptions) {
    $effect(() => {
      const track = this.selectedLyrics;
      this.#cues = [];
      this.#error = null;

      if (!track) {
        this.#isLoading = false;
        return;
      }

      this.#isLoading = true;
      if (track.content.kind === "inline") {
        this.#cues = lyricsIntoCues(track.content.observations, track.timing);
        this.#isLoading = false;
        return;
      }

      const controller = new AbortController();
      void fetch(browserReachableServiceUrl(track.content.url, PUBLIC_CONVEX_URL), {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unable to load lyrics: HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((document: unknown) => {
          this.#cues = lyricsIntoCues(parseLyricObservations(document), track.timing);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          this.#error = cause instanceof Error ? cause.message : "Unable to load lyrics";
          console.error("Unable to load karaoke lyrics", cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) this.#isLoading = false;
        });

      return () => controller.abort();
    });
  }

  get availableLyrics() {
    return this.options.getLyrics().filter(isUsableLyricsTrack);
  }

  get selectedLyrics() {
    return (
      this.availableLyrics.find(({ id }) => id === this.options.getSelectedLyricsId()) ??
      this.availableLyrics[0]
    );
  }

  get captionsUrl() {
    return (
      this.selectedLyrics?.captionsUrl ??
      this.availableLyrics.find(({ captionsUrl }) => captionsUrl)?.captionsUrl
    );
  }

  get lyricsOffsetMs() {
    const sharedOffsetMs = this.options.getLyricsOffsetMs();
    return sharedOffsetMs !== undefined
      ? sharedOffsetMs
      : (this.selectedLyrics?.suggestedOffsetMs ?? 0);
  }

  get cues() {
    return this.#cues;
  }

  get isLoading() {
    return this.#isLoading;
  }

  get error() {
    return this.#error;
  }

  get currentTime() {
    return this.options.getCurrentTime();
  }

  get adjustedTime() {
    return (
      this.currentTime - (Number.isFinite(this.lyricsOffsetMs) ? this.lyricsOffsetMs : 0) / 1_000
    );
  }

  get activeCueIndex() {
    return findKaraokeCue(this.#cues, this.adjustedTime);
  }

  get activeCue() {
    const index = this.activeCueIndex;
    return index >= 0 ? this.#cues[index] : undefined;
  }

  get nextCue() {
    const index = this.activeCueIndex;
    return index >= 0 ? this.#cues[index + 1] : undefined;
  }

  get wordTiming() {
    return this.selectedLyrics?.timing === "word";
  }
}
