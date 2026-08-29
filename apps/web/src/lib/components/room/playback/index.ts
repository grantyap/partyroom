import Error from "./playback-error.svelte";
import Lyrics from "./playback-lyrics.svelte";
import NowPlaying from "./playback-now-playing.svelte";
import Player from "./playback-player.svelte";
import {
  Queue,
  QueueCount,
  QueueEmpty,
  QueueForm,
  QueueItem,
  QueueList,
} from "./queue";
import Root from "./playback-root.svelte";
import Share from "./share-room-popover.svelte";
import TvMode from "./playback-tv-mode.svelte";

export {
  Root,
  NowPlaying,
  Lyrics,
  Player,
  TvMode,
  Share,
  Error,
  Queue,
  QueueCount,
  QueueEmpty,
  QueueForm,
  QueueItem,
  QueueList,
  //
  Root as PlaybackRoot,
  NowPlaying as PlaybackNowPlaying,
  Lyrics as PlaybackLyrics,
  Player as PlaybackPlayer,
  TvMode as PlaybackTvMode,
  Share as PlaybackShare,
  Error as PlaybackError,
  Queue as PlaybackQueue,
  QueueCount as PlaybackQueueCount,
  QueueEmpty as PlaybackQueueEmpty,
  QueueForm as PlaybackQueueForm,
  QueueItem as PlaybackQueueItem,
  QueueList as PlaybackQueueList,
};

export { usePlayback } from "./context.svelte";
export type { ErrorRenderProps } from "./playback-error.svelte";
export type { LyricsRenderProps } from "./playback-lyrics.svelte";
export type { NowPlayingRenderProps } from "./playback-now-playing.svelte";
export type { PlayerEmptyRenderProps } from "./playback-player.svelte";
export type {
  QueueCountRenderProps,
  QueueItemData,
  QueueItemRenderProps,
  QueueListRenderProps,
} from "./queue";
export type { ShareTriggerRenderProps } from "./share-room-popover.svelte";
export type { TvModeRenderProps } from "./playback-tv-mode.svelte";
