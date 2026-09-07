/**
 * The room's shared playback timeline. Create one OnlineTimingObject in the
 * component that owns room playback, then share it with players, lyrics, and controls.
 *
 * The modules are separate because they answer different questions: timing tells
 * everyone where playback should be; synced-playback makes one device play there.
 * Lyrics and controls need the timeline without creating a media player. Keeping
 * device-specific audio delays in synced-playback also prevents those delays from
 * changing the timeline shared by the room.
 *
 * @see {@link OnlineTimingObject} for server callbacks and a Svelte setup example.
 * @see `$lib/synced-playback` for playing audio/video with output delay compensation.
 */
export {
  OnlineTimingObject,
  type OnlineTimingObjectOptions,
  type TimingObjectReadyState,
} from "./online-timing-object.svelte";
export type { ProviderTimingState, TimingStateVector, TimingStateVectorUpdate } from "./types";
