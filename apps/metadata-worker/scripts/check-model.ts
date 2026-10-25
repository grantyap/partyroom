/**
 * Run managed inference fixtures: METADATA_DEVICE=metal bun apps/metadata-worker/scripts/check-model.ts
 * Multilingual/version smoke fixtures only, not a comprehensive accuracy benchmark.
 */
import assert from "node:assert/strict";
import { runManagedProcess } from "@partyroom/activity-worker";
import { inferenceCommand, processResultSchema } from "../src/activity";
import { OLLAMA_URL } from "../src/model";

const cases = [
  {
    title: "ENHYPEN (엔하이픈) 'Bloody Paradise' Official MV",
    artistName: "ENHYPEN",
    trackName: "Bloody Paradise",
  },
  {
    title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
    artistName: "Rick Astley",
    trackName: "Never Gonna Give You Up",
  },
  {
    title: "Dua Lipa – Levitating [Official Audio]",
    artistName: "Dua Lipa",
    trackName: "Levitating",
  },
  { title: "Adele - Hello (Live)", artistName: "Adele", trackName: "Hello (Live)" },
  {
    title: "Example Artist - Drowning (Avicii Remix) [Official Audio]",
    artistName: "Example Artist",
    trackName: "Drowning (Avicii Remix)",
  },
  { title: "[MV] IU(아이유) _ Blueming(블루밍)", artistName: "IU", trackName: "Blueming" },
  {
    title: "YOASOBI「アイドル」 Official Music Video",
    artistName: "YOASOBI",
    trackName: "アイドル",
  },
  {
    title: "Ed Sheeran - Perfect (Acoustic)",
    artistName: "Ed Sheeran",
    trackName: "Perfect (Acoustic)",
  },
  { title: "Never Gonna Give You Up", artistName: null, trackName: "Never Gonna Give You Up" },
];
const started = performance.now();
await runManagedProcess(inferenceCommand("prepare"), {
  signal: AbortSignal.timeout(600_000),
  terminateTimeoutMs: 10_000,
});
await runManagedProcess(inferenceCommand("verify"), {
  signal: AbortSignal.timeout(120_000),
  terminateTimeoutMs: 10_000,
});
for (const { title, artistName, trackName } of cases) {
  const start = performance.now();
  const result = await runManagedProcess(inferenceCommand("extract", { title }), {
    signal: AbortSignal.timeout(120_000),
    terminateTimeoutMs: 10_000,
  });
  const { metadata, inference } = processResultSchema.parse(JSON.parse(result.stdout));
  assert.deepEqual(metadata, { ...(artistName ? { artistName } : {}), trackName }, title);
  await assert.rejects(fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(1_000) }));
  console.log(
    `PASS ${(performance.now() - start).toFixed(0)}ms, ${inference.device}, ${inference.gpuBytes} GPU bytes: ${title}`,
  );
}
console.log(
  `PASS ${cases.length} metadata fixtures in ${(performance.now() - started).toFixed(0)}ms`,
);
