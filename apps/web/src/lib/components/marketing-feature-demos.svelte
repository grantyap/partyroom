<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Slider } from "$lib/components/ui/slider";
	import { ArrowRight, Mic2, Check, ListMusic, MessageCircle, Music2, Plus, RotateCcw, Share2, Tv, Users } from "@lucide/svelte";
	import QRCode from "qrcode";
	import KaraokeLyricLine from "./room/playback/karaoke-lyric-line.svelte";
	import type { KaraokeCue } from "$lib/karaoke";

	const cue: KaraokeCue = {
		start: 0, end: 6,
		words: "This is our night to sing".split(" ").map((text, time) => ({ text, time, duration: 1 })),
	};
	const bars = [20, 34, 24, 48, 62, 40, 72, 52, 30, 56, 80, 44, 60, 36, 70, 48, 28, 58, 74, 42, 64, 32, 50, 24];
	let lyricTime = $state(2.5);
	let joined = $state(false);
	let roomTime = $state(2.5);
	let roomTab = $state<"queue" | "chat">("queue");
	let queued = $state(false);
	let message = $state("");
	// ponytail: show the latest preview message; add history if the demo needs a conversation.
	let sentMessage = $state("");
	let qrCode = $state("");

	onMount(() => {
		let cancelled = false;
		void QRCode.toDataURL("https://partyroom.example/app/rooms/the-living-room", {
			width: 256, margin: 2, color: { dark: "#0c0b10", light: "#ffffff" },
		}).then((url) => { if (!cancelled) qrCode = url; }).catch(() => {});
		return () => { cancelled = true; };
	});
</script>

{#snippet lyrics(time: number, compact = false)}
	<div class:compact class="lyric-stage">
		<Music2 size={compact ? 18 : 28} aria-hidden="true" />
		<KaraokeLyricLine {cue} currentTime={time} wordTiming wordProgress class="demo-lyrics" />
		<p class="next-line">Let the whole room sing along</p>
	</div>
{/snippet}

<section id="features" aria-labelledby="features-heading" class="features">
	<div class="section-intro">
		<p class="eyebrow">Karaoke, together</p>
		<h2 id="features-heading">Pick a song.<br />Bring your friends.</h2>
		<p class="muted">Turn the music you love into karaoke, and sing it together.</p>
	</div>

	<div class="feature-grid">
	<div class="feature-row spotlight">
		<div class="feature-copy">
			<p class="eyebrow">01 / Make it karaoke</p>
			<h3>Keep the music.<br />Lose the vocals.</h3>
			<p>Paste a song link. Partyroom removes the lead vocals and syncs the lyrics, so you can sing the songs you actually want to sing.</p>
			<p class="try-it">Drag the slider to follow the lyrics.</p>
		</div>
		<div class="demo-card transformation" aria-label="Karaoke visual preview">
			<div class="source-song">
				<p class="eyebrow">The song you love</p>
				<div class="record-art" aria-hidden="true"><div class="record"><Music2 size={32} /></div><span>YOUR<br />FAVORITE<br />SONG.</span></div>
				<div class="source-caption"><strong>The original song.</strong><p class="preview-note">Original vocals + music</p></div>
				<div class="song-link"><Share2 size={14} aria-hidden="true" />Paste a song link</div>
				<div class="transform-arrow" aria-hidden="true"><ArrowRight size={24} /></div>
			</div>
			<div class="karaoke-result">
			<div class="card-header"><span><Mic2 size={15} aria-hidden="true" />Your karaoke version</span></div>
			<div class="result-caption"><p>Just add your voice.</p><span>Lyrics light up as you sing.</span></div>
			{@render lyrics(lyricTime)}
			<div class="waveform" aria-hidden="true">
				{#each bars as height, i}<span style:height={`${height}%`} class:past={i / bars.length <= lyricTime / 6}></span>{/each}
			</div>
			<div class="demo-controls">
				<p id="lyric-preview-label" class="slider-label">Follow the lyrics <span>{lyricTime.toFixed(1)}s / 6s</span></p>
				<Slider id="lyric-preview" type="single" min={0} max={6} step={0.1} bind:value={lyricTime} aria-labelledby="lyric-preview-label" class="demo-slider" />
			</div>
		</div>
		</div>
	</div>

	<div class="feature-row invite-feature">
		<div class="feature-copy">
			<p class="eyebrow">02 / Invite friends</p>
			<h3>Everyone’s<br />invited.</h3>
			<p>Share a link or let friends scan the QR code. They can join from their phones and add songs to the queue.</p>
			<p class="try-it">Try inviting Alex below.</p>
		</div>
		<div class="demo-card invite-demo" aria-label="Room invitation preview">
			<div class="card-header"><span><Users size={15} aria-hidden="true" />The living room</span></div>
			<div class="invite-scene">
				<div class="share-panel">
					<p class="eyebrow">01 / Scan</p><h4>Scan to join.</h4>
					<div class="qr-frame">{#if qrCode}<img src={qrCode} alt="Example QR code for a shared room" />{:else}<Share2 size={48} aria-hidden="true" />{/if}</div>
					<p class="preview-note">Opens the room on your phone.</p>
					<Button class="primary-button" onclick={() => joined = !joined}>{#if joined}<RotateCcw size={15} aria-hidden="true" />Reset{:else}<Plus size={15} aria-hidden="true" />Invite Alex{/if}</Button>
				</div>
				<div class="join-connector" aria-hidden="true"><ArrowRight size={24} /></div>
				<div class="phone" class:connected={joined}>
					<div class="phone-notch"></div>
					<p class="eyebrow">02 / Join</p>
					<p class="phone-brand">Partyroom</p>
					<div class="avatar">{joined ? "A" : "?"}</div>
					<p class="phone-heading">{joined ? "You’re in, Alex." : "Room for one more."}</p>
					<p class="preview-note">{joined ? "The living room" : "Your friends are waiting."}</p>
					{#if joined}<div class="phone-ready"><Check size={16} aria-hidden="true" />Ready to sing</div>{/if}
				</div>
			</div>
			<div class="members" role="status"><div class="avatar mini">Y</div>{#if joined}<div class="avatar mini friend">A</div>{/if}<span>{joined ? "2 people in the room" : "1 person in the room"}</span></div>
		</div>
	</div>

	<div class="feature-row sync-feature">
		<div class="feature-copy">
			<p class="eyebrow">03 / Sing in sync</p>
			<h3>In time.<br />On every screen.</h3>
			<p>Lyrics stay in sync on the TV and everyone’s phones. Pick the next song or send a message without leaving the room.</p>
			<p class="try-it">Drag the slider. Both screens stay in sync.</p>
		</div>
		<div class="demo-card" aria-label="Shared playback preview">
			<div class="card-header"><span><Tv size={15} aria-hidden="true" />Shared playback</span><span class="pill"><span class="status-dot"></span>In sync</span></div>
			<div class="paired-screens">
				<div class="desktop-screen"><p class="screen-label">On the big screen</p>{@render lyrics(roomTime, true)}</div>
				<div class="phone sync-phone"><div class="phone-notch"></div><p class="screen-label">On your phone</p>{@render lyrics(roomTime, true)}</div>
			</div>
			<div class="demo-controls sync-controls"><p id="room-preview-label" class="slider-label">Song position <span>{roomTime.toFixed(1)}s</span></p><Slider id="room-preview" type="single" min={0} max={6} step={0.1} bind:value={roomTime} aria-labelledby="room-preview-label" class="demo-slider" /></div>
			<div class="room-tabs" aria-label="Room preview panels">
				<Button variant="ghost" class="h-auto rounded-none hover:bg-transparent" aria-pressed={roomTab === "queue"} onclick={() => roomTab = "queue"}><ListMusic size={16} aria-hidden="true" />Queue <span class="queue-count">{queued ? 2 : 1}</span></Button>
				<Button variant="ghost" class="h-auto rounded-none hover:bg-transparent" aria-pressed={roomTab === "chat"} onclick={() => roomTab = "chat"}><MessageCircle size={16} aria-hidden="true" />Chat</Button>
			</div>
			<div class="room-panel">
				{#if roomTab === "queue"}
					<div class="queue-song"><span class="avatar mini">A</span><div><strong>One for the duet</strong><p class="preview-note">Alex’s pick · Up next</p></div><Music2 size={18} aria-hidden="true" /></div>
					{#if queued}<div class="queue-song"><span class="avatar mini friend">Y</span><div><strong>The encore</strong><p class="preview-note">Your pick · Added to the queue</p></div><Check size={18} aria-hidden="true" /></div>{/if}
					<Button variant="outline" class="small-button queue-add" aria-pressed={queued} onclick={() => queued = !queued}>{#if queued}<RotateCcw size={15} aria-hidden="true" />Reset queue{:else}<Plus size={15} aria-hidden="true" />Queue an encore{/if}</Button>
				{:else}
					<p class="chat-message"><strong>Alex</strong> Who’s up for a duet?</p>
					{#if sentMessage}<p class="chat-message own"><strong>You</strong> {sentMessage}</p>{/if}
					<form class="chat-form" onsubmit={(event) => { event.preventDefault(); sentMessage = message.trim(); message = ""; }}>
						<Input aria-label="Preview chat message" placeholder="Write a message…" maxlength={120} required bind:value={message} />
						<Button class="primary-button" type="submit" disabled={!message.trim()}>Send</Button>
					</form>
				{/if}
			</div>
			<p class="preview-note panel-note" role="status">{roomTab === "chat" ? "Chat with everyone in the room." : queued ? "Your encore is in the shared queue." : "Anyone in the room can add a song."}</p>
		</div>
	</div>
	</div>
</section>

<style>
	.features { --primary: var(--purple); --primary-foreground: var(--room); --background: var(--room); --border: var(--line); --input: var(--line); --ring: var(--purple); max-width: 1440px; margin: auto; padding: 0 24px 96px; scroll-margin-top: 32px; }
	.section-intro { max-width: 850px; margin-bottom: 48px; }
	.eyebrow { color: var(--purple); font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
	h2, h3 { font-family: var(--font-heading); font-weight: 700; letter-spacing: -.055em; line-height: 1.05; }
	h2 { font-size: clamp(2.75rem, 5vw, 5rem); margin: 20px 0; }
	h3 { font-size: clamp(2rem, 3vw, 3rem); margin: 22px 0; }
	.muted, .feature-copy > p:not(.eyebrow) { color: var(--muted); line-height: 1.8; }
	.feature-grid { display: grid; gap: 24px; }
	.feature-row { min-width: 0; padding: 28px; border: 1px solid var(--line); border-radius: 28px; background: linear-gradient(145deg, #20182d, var(--surface) 65%); }
	.sync-feature { background: linear-gradient(155deg, #172326, var(--surface) 60%); }
	.invite-feature { background: linear-gradient(145deg, #292119, var(--surface) 60%); }
	.feature-copy { max-width: 540px; margin-bottom: 28px; }
	.feature-copy .try-it { color: var(--foreground) !important; font-size: 12px; margin-top: 16px; }
	.demo-card { min-width: 0; border: 1px solid var(--line); border-radius: 24px; overflow: hidden; background: var(--surface); box-shadow: 0 20px 60px #0003; }
	.card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px; border-bottom: 1px solid var(--line); }
	.card-header > span { display: flex; gap: 8px; align-items: center; font-size: 11px; }
	.card-header > span:first-child { text-transform: uppercase; letter-spacing: .1em; }
	.pill { border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; color: var(--muted); white-space: nowrap; }
	.transformation { position: relative; overflow: visible; background: var(--stage); }
	.source-song { position: relative; padding: 28px; background: #211929; border-radius: 24px 24px 0 0; }
	.record-art { position: relative; display: grid; align-items: start; height: 220px; margin: 20px 0; padding: 24px; overflow: hidden; border-radius: 14px; background: linear-gradient(135deg, #e8cc82, #c29edf 65%, #7959ad); color: #24142d; }
	.record-art > span { position: relative; font-size: 24px; font-weight: 850; line-height: .95; letter-spacing: -.06em; }
	.record { position: absolute; right: -30px; bottom: -90px; display: grid; place-items: center; width: 200px; height: 200px; border-radius: 50%; background: repeating-radial-gradient(circle, #281c33 0 2px, #37253e 3px 5px); transform: rotate(-20deg); color: var(--purple); }
	.record :global(svg) { background: #e8cc82; border-radius: 50%; padding: 10px; width: 62px; height: 62px; color: #302039; }
	.source-caption strong { font-size: 13px; }
	.source-caption p { margin-top: 4px; }
	.song-link { display: flex; align-items: center; gap: 8px; border: 1px solid #6e566f; padding: 12px; border-radius: 8px; margin-top: 20px; font-size: 12px; color: #ded0e7; }
	.transform-arrow { position: absolute; left: 50%; top: 100%; z-index: 1; display: grid; place-items: center; width: 48px; height: 48px; transform: translate(-50%, -50%) rotate(90deg); border: 6px solid var(--stage); border-radius: 50%; background: var(--purple); color: var(--room); }
	.karaoke-result { min-width: 0; overflow: hidden; border-radius: 0 0 24px 24px; }
	.result-caption { text-align: center; padding-top: 28px; }
	.result-caption p { font-family: var(--font-heading); font-size: 32px; letter-spacing: -.04em; }
	.result-caption span { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); }
	.join-connector { color: var(--purple); }
	.lyric-stage { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 150px; gap: 16px; padding: 28px 24px; text-align: center; background: radial-gradient(ellipse at center, #b48aff0d, transparent 75%); }
	.lyric-stage :global(svg) { color: var(--purple); }
	.lyric-stage :global(.demo-lyrics) { max-width: 100%; font-size: clamp(1.4rem, 2.6vw, 2rem); font-weight: 700; line-height: 1.5; }
	.lyric-stage :global([data-lyric-word]) { display: inline-block; margin-right: .28em; color: transparent; background: linear-gradient(90deg, var(--lyrics) 0%, var(--lyrics) var(--karaoke-progress), var(--muted) var(--karaoke-progress), var(--muted) 100%); background-clip: text; }
	.next-line { font-size: 11px; color: var(--muted); }
	.waveform { height: 48px; display: flex; align-items: center; justify-content: center; gap: 5px; margin: 0 24px 20px; }
	.waveform span { width: 7px; border-radius: 8px; background: var(--line); }
	.waveform span.past { background: var(--purple); }
	.demo-controls { padding: 20px; border-top: 1px solid var(--line); }
	.demo-controls .slider-label { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--muted); }
	.demo-controls .slider-label span { font-variant-numeric: tabular-nums; }
	.features :global(.demo-slider) { height: 32px; cursor: ew-resize; }
	.features :global(.demo-slider [data-slot="slider-track"]) { background: var(--line); }
	.features :global(.demo-slider [data-slot="slider-thumb"]) { width: 16px; height: 16px; background: var(--purple); }
	.features :global(.small-button), .features :global(.primary-button) { min-height: 44px; padding: 10px 12px; font-size: 12px; font-weight: 600; }
	.features :global(.small-button:hover) { border-color: var(--purple); background: var(--surface); }
	.preview-note { font-size: 11px; color: var(--muted); line-height: 1.6; }
	.invite-scene { display: flex; justify-content: center; align-items: center; gap: 12px; padding: 32px 16px; background: radial-gradient(ellipse at center, #b48aff0d, transparent 75%); }
	.share-panel { text-align: center; flex: 1; max-width: 220px; }
	.share-panel > :global(svg) { margin: auto; color: var(--purple); }
	h4 { font-size: 14px; font-weight: 600; margin: 12px 0; }
	.qr-frame { display: grid; place-items: center; width: 132px; height: 132px; margin: 16px auto 10px; border-radius: 10px; background: white; color: var(--room); }
	.qr-frame img { width: 100%; border-radius: 10px; }
	.share-panel :global(button) { margin-top: 16px; }
	.phone { width: 140px; min-height: 250px; flex-shrink: 0; border: 2px solid var(--line); border-radius: 26px; padding: 12px; background: var(--room); text-align: center; transition: border-color .3s, transform .3s; }
	.phone.connected { border-color: var(--purple); transform: translateY(-6px) rotate(3deg); }
	.phone-notch { width: 40px; height: 5px; border-radius: 99px; background: var(--line); margin: 0 auto 16px; }
	.phone > :global(svg) { margin: auto; color: var(--purple); }
	.phone-brand { font-size: 12px; font-weight: 600; margin-top: 6px; }
	.avatar { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #b48aff1f; color: var(--purple); font-size: 20px; margin: 20px auto 12px; }
	.phone-heading { font-size: 12px; font-weight: 600; }
	.phone-ready { display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--purple); margin-top: 16px; font-size: 11px; }
	.members { display: flex; align-items: center; gap: 8px; padding: 20px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); min-height: 76px; }
	.avatar.mini { width: 28px; height: 28px; font-size: 11px; flex-shrink: 0; margin: 0; }
	.avatar.friend { background: #e6ce8c1f; color: var(--lyrics); }
	.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--purple); }
	.paired-screens { position: relative; display: flex; align-items: center; padding: 32px 20px 22px; gap: 12px; background: radial-gradient(ellipse, #b48aff13, transparent 70%); }
	.desktop-screen { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--stage); overflow: hidden; }
	.screen-label { color: var(--muted); font-size: 10px; text-align: center; padding-top: 14px; }
	.sync-phone { width: 118px; min-height: 0; border-radius: 20px; padding: 10px 6px; background: var(--stage); }
	.sync-phone .phone-notch { margin-bottom: 0; }
	.compact { min-height: 145px; gap: 10px; padding: 20px 12px; }
	.compact :global(.demo-lyrics) { font-size: 15px; }
	.compact .next-line { font-size: 9px; }
	.sync-phone .compact :global(.demo-lyrics) { font-size: 11px; }
	.sync-phone .next-line { display: none; }
	.sync-controls { padding-top: 0; border-top: 0; }
	.room-tabs { display: flex; gap: 24px; padding: 0 20px; border-block: 1px solid var(--line); }
	.room-tabs :global(button) { display: flex; align-items: center; gap: 7px; padding: 14px 0; border-bottom: 2px solid transparent; font-size: 12px; color: var(--muted); }
	.room-tabs :global(button[aria-pressed="true"]) { border-color: var(--purple); color: var(--foreground); }
	.queue-count { font-size: 10px; padding: 0 5px; background: #b48aff1f; border-radius: 5px; color: var(--purple); }
	.room-panel { padding: 8px 20px 0; min-height: 152px; }
	.queue-song { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
	.queue-song div { flex: 1; }
	.queue-song strong { font-size: 12px; font-weight: 500; }
	.queue-song > :global(svg) { color: var(--purple); }
	.features :global(.queue-add) { margin-block: 8px; }
	.chat-message { font-size: 12px; background: var(--room); border-radius: 10px; padding: 10px; margin-block: 8px; overflow-wrap: anywhere; }
	.chat-message strong { color: var(--purple); margin-right: 6px; }
	.chat-message.own { border-left: 2px solid var(--purple); }
	.chat-form { display: flex; gap: 8px; padding-top: 8px; }
	.chat-form :global(input) { min-width: 0; flex: 1; padding: 10px; background: var(--room); border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }
	.panel-note { padding: 12px 20px 20px; }
	@media (min-width: 640px) {
		.features { padding-inline: 48px; }
		.feature-row { padding: 32px; }
		.transformation { display: grid; grid-template-columns: 240px minmax(0, 1fr); }
		.source-song { border-radius: 24px 0 0 24px; display: flex; flex-direction: column; justify-content: center; }
		.record-art { height: 210px; flex-shrink: 0; }
		.transform-arrow { top: 50%; left: 100%; transform: translate(-50%, -50%); }
		.karaoke-result { border-radius: 0 24px 24px 0; }
		.spotlight .feature-copy { max-width: none; display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; }
		.spotlight .feature-copy .eyebrow { grid-column: 1 / -1; }
		.spotlight h3 { grid-row: span 2; margin-bottom: 0; }
		.spotlight .feature-copy > p:not(.eyebrow) { padding-top: 18px; }
	}
	@media (min-width: 1100px) {
		.features { padding-inline: 80px; }
		.feature-grid { grid-template-columns: 1fr 1fr; }
		.spotlight { grid-column: 1 / -1; padding: 40px; }
		.transformation { grid-template-columns: 300px minmax(0, 1fr); }
		.source-song { padding: 32px; }
		.spotlight .lyric-stage :global(.demo-lyrics) { font-size: 32px; }
		.invite-feature, .sync-feature { display: flex; flex-direction: column; }
		.invite-feature .demo-card { flex: 1; display: flex; flex-direction: column; }
		.invite-feature .invite-scene { flex: 1; }
	}
	@media (max-width: 639px) {
		.features { padding-inline: 16px; }
		.feature-row { padding: 20px; }
		.source-song { position: relative; padding: 20px; display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 12px; }
		.source-song .eyebrow { grid-column: 1 / -1; }
		.record-art { grid-row: span 2; margin: 0; height: 100px; padding: 12px; }
		.record-art > span { font-size: 13px; }
		.record { width: 90px; height: 90px; right: -30px; bottom: -48px; }
		.record :global(svg) { width: 32px; height: 32px; padding: 8px; }
		.source-caption { align-self: end; }
		.song-link { margin: 0; font-size: 10px; padding: 8px; }
		.transform-arrow { width: 38px; height: 38px; }
		.result-caption p { font-size: 28px; }
		.invite-scene { gap: 8px; padding-inline: 12px; }
		.join-connector { display: none; }
		.phone { width: 112px; min-height: 235px; }
		.qr-frame { width: 96px; height: 96px; }
		.share-panel h4 { font-size: 12px; }
		.sync-phone { width: 90px; min-height: 0; }
		.card-header { padding-inline: 12px; }
		.card-header > span:first-child { font-size: 9px; }
		.paired-screens { padding-inline: 12px; gap: 8px; }
		.features :global(.primary-button), .features :global(.small-button) { padding-inline: 8px; font-size: 11px; }
		.features :global(.chat-form input) { font-size: 16px; }
	}
	@media (prefers-reduced-motion: reduce) { .phone { transition: none; } }
</style>
