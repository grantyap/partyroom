/**
 * Use SyncedMediaPlayback to play audio or video in time with the room's timeline.
 * It also accounts for the delay before sound reaches the output device when the
 * browser supports it. Files under internal/ are managed by this controller.
 *
 * This module handles playback on one device, while timing provides the timeline
 * shared by the room. They are separate so device-specific audio delays stay local
 * and other features, such as lyrics, can use timing without creating a player.
 * Playback depends on timing; timing does not depend on playback.
 *
 * @see {@link SyncedMediaPlayback} for usage.
 * @see `$lib/timing` for creating the timeline shared by players, lyrics, and controls.
 */
export {
  SyncedMediaPlayback,
  type SyncedMediaPlaybackOptions,
} from "./synced-media-playback.svelte";
