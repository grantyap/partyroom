<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import partyroomLogo from "$lib/assets/icons/Partyroom logo.svg";
	import ArrowUpRightIcon from "@lucide/svelte/icons/arrow-up-right";
	import { Radio, Tv, Music2, ListMusic, Mic2, MessageCircle, Users, Pause, SkipForward } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	const { data, form }: PageProps = $props();
	let accessOpen = $state(false);
	const name = $derived(form && "name" in form ? form.name : "");
	const email = $derived(form && "email" in form ? form.email : "");
	const code = $derived(form && "code" in form ? form.code : "");
	const accessRequired = $derived(
		page.url.searchParams.get("access") === "required",
	);
</script>

<svelte:head>
 <title>Partyroom — Karaoke every song ever.</title>
 <meta name="description" content="Turn your next night in into karaoke. Paste a song link, share a room, and sing along with friends. Join Partyroom early access." />
</svelte:head>
{#snippet accessCodeForm(id: string)}
	<form method="POST" action="?/access" class="flex gap-2">
		<label class="sr-only" for={id}>Access code</label>
		<input
			{id}
			name="code"
			type="text"
			autocomplete="one-time-code"
			required
			maxlength="100"
			value={code}
			class="h-11 min-w-0 flex-1 rounded-lg border border-(--line) bg-(--room) px-4 font-mono text-sm tracking-wider text-(--foreground) placeholder:font-sans placeholder:tracking-normal placeholder:text-(--muted) focus:border-(--foreground) focus:ring-2 focus:ring-(--purple) focus:outline-none"
			placeholder="Enter your code"
		/>
		<button
			type="submit"
			class="h-11 rounded-lg border border-(--line) px-4 text-sm font-semibold transition hover:border-(--foreground) hover:bg-(--surface) focus:ring-2 focus:ring-(--purple) focus:outline-none"
		>
			Enter
		</button>
	</form>
	{#if form?.accessError}
		<p class="mt-3 text-sm text-(--error)" role="alert">
			{form.accessError}
		</p>
	{:else if accessRequired}
		<p class="mt-3 text-sm text-(--muted)" role="status">
			Enter your access code to continue.
		</p>
	{/if}
{/snippet}

<div data-marketing-page class="min-h-svh [html:has(&)]:[--room:#0c0b10] [html:has(&)]:bg-(--room) [body:has(&)]:bg-(--room) [--foreground:#f5f0ff] [--muted:#b2aabd] [--purple:#b48aff] [--surface:#17131f] [--stage:#030305] [--line:#35303f] [--error:#ff9baf] [--lyrics:oklch(0.83_0.18_85)] bg-(--room) bg-[radial-gradient(ellipse_at_80%_15%,var(--surface),transparent_45%)] text-(--foreground) selection:bg-(--purple) selection:text-(--room) [color-scheme:dark] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-offset-4">
 <header class="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6 py-6 sm:px-12 lg:px-20">
  <a href="/" aria-label="Partyroom home" class="flex shrink-0 items-center gap-2 font-medium transition-opacity hover:opacity-75">
   <img src={partyroomLogo} alt="" class="size-8 rounded-lg" />
   <span class="text-xl font-semibold tracking-tight">Partyroom</span>
  </a>
  <nav aria-label="Main navigation" class="flex items-center gap-8 text-sm font-medium">
   <a href="#how-it-works" class="hidden hover:underline sm:block">How it works</a>
   <a href={data.hasEarlyAccess ? "/app" : "#access"} onclick={() => accessOpen = true} class="underline decoration-(--purple) decoration-2 underline-offset-4">{data.hasEarlyAccess ? "Go to app" : "Have a code?"}</a>
  </nav>
 </header>
 <main>
  <section aria-labelledby="headline" class="mx-auto grid max-w-[1440px] gap-12 px-6 pt-12 pb-16 sm:px-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-10 lg:px-20 lg:pt-16 lg:pb-24">
   <div>
    <p class="mb-6 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] uppercase"><span class="size-2 rounded-full bg-(--purple)"></span>Karaoke with friends</p>
    <h1 id="headline" class="font-heading text-[clamp(3.3rem,8.3vw,8rem)] leading-[0.94] font-extrabold tracking-[-0.075em]">Karaoke<br />every song<br /><span class="text-(--purple)">ever.</span></h1>
    <p class="mt-8 max-w-sm text-lg leading-7 text-(--muted)">Pick a song, send your friends the room link, and sing along. Partyroom removes the vocals and puts the lyrics on screen.</p>
    <a href={data.hasEarlyAccess ? "/app" : "#invite"} class="mt-8 inline-flex items-center gap-10 rounded-full bg-(--purple) px-7 py-4 text-sm font-semibold text-(--room) transition hover:bg-(--purple)/80">{data.hasEarlyAccess ? "Let’s sing" : "Get early access"}<ArrowUpRightIcon class="size-5" aria-hidden="true" /></a>
    <p class="mt-4 text-xs text-(--muted)">Works in your browser.</p>
   </div>
   <div class="relative isolate mx-auto w-full max-w-[560px] py-8" aria-hidden="true">
    <div class="absolute inset-0 -z-10 rounded-full bg-(--purple)/15 blur-3xl"></div>
    <div class="mb-4 flex items-center justify-between gap-3 px-1">
     <div><p class="text-[10px] tracking-[0.14em] text-(--muted) uppercase">Listening room</p><p class="mt-1 font-heading text-lg">The living room</p></div>
     <span class="flex items-center gap-2 text-xs text-(--muted)"><Users class="size-4" />4 here</span>
    </div>
    <div class="overflow-hidden rounded-[1.25rem] border border-(--line) bg-(--stage) shadow-[0_8px_32px_var(--room)]">
     <div class="flex items-center justify-between gap-3 px-5 py-4">
      <span class="flex items-center gap-2 text-[10px] tracking-[0.16em] text-(--muted)"><Radio class="size-4" />THE STAGE</span>
      <span class="flex items-center gap-2 rounded-lg border border-(--line) bg-(--surface) px-3 py-1.5 text-[10px]"><Tv class="size-3.5" />TV mode</span>
     </div>
     <div class="flex aspect-video flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,var(--surface),var(--stage)_75%)] px-6 text-center">
      <Music2 class="mb-5 size-8 text-(--purple)" strokeWidth={1.4} />
      <p class="text-[clamp(1.25rem,2.6vw,2rem)] leading-snug font-semibold tracking-tight"><span class="text-(--lyrics)">Your song.</span> Without the vocals.</p>
      <p class="mt-3 text-sm text-(--muted)">Lyrics on screen. Everyone singing along.</p>
     </div>
     <div class="flex items-center gap-3 border-t border-(--line) px-5 py-3 text-(--muted)"><Pause class="size-4" /><SkipForward class="size-4" /><span class="text-[10px] tabular-nums">02:34</span><div class="h-1 flex-1 rounded-full bg-(--line)"><div class="h-1 w-2/3 rounded-full bg-(--purple)"></div></div><span class="text-[10px] tabular-nums">03:48</span></div>
     <div class="flex items-center gap-3 px-5 py-4"><span class="grid size-11 shrink-0 place-items-center rounded-xl bg-(--surface) text-(--purple)"><Music2 class="size-5" /></span><div><p class="text-[10px] tracking-[0.14em] text-(--muted) uppercase">Now playing</p><p class="mt-1 font-heading text-base">Your favorite song</p></div></div>
    </div>
    <div class="mt-4 overflow-hidden rounded-2xl border border-(--line) bg-(--surface)">
     <div class="flex items-center gap-6 border-b border-(--line) px-5 text-xs">
      <span class="flex items-center gap-2 border-b-2 border-(--purple) py-4"><ListMusic class="size-4" />Queue <span class="rounded-full bg-(--purple)/15 px-1.5 text-(--purple)">2</span></span>
      <span class="flex items-center gap-2 text-(--muted)"><Mic2 class="size-4" />Lyrics</span>
      <span class="flex items-center gap-2 text-(--muted)"><MessageCircle class="size-4" />Chat</span>
     </div>
     <div class="divide-y divide-(--line) px-5">
      {#each [{ title: 'The next song', name: 'Alex', duration: '3:24' }, { title: 'One for the duet', name: 'Sam', duration: '4:10' }] as song}
       <div class="flex items-center gap-3 py-3"><Music2 class="size-4 shrink-0 text-(--muted)" /><div><p class="text-sm font-medium">{song.title}</p><p class="mt-1 flex items-center gap-1.5 text-[10px] text-(--muted)"><span class="grid size-4 place-items-center rounded-full bg-(--purple)/15 text-(--purple)">{song.name[0]}</span>{song.name} · {song.duration}</p></div></div>
      {/each}
     </div>
    </div>
   </div>
  </section>
  <div class="overflow-hidden border-y border-(--line) bg-(--surface) py-5 text-(--purple) text-center text-sm font-bold tracking-[0.12em] uppercase sm:text-lg">Vocals removed. <span class="mx-5" aria-hidden="true">✳</span> Lyrics synced.</div>
  <section id="how-it-works" aria-labelledby="how-heading" class="mx-auto max-w-[1440px] scroll-mt-8 px-6 py-20 sm:px-12 lg:px-20 lg:py-28">
   <div class="flex flex-wrap items-end justify-between gap-6"><h2 id="how-heading" class="font-heading max-w-xl text-4xl leading-[1.05] font-bold tracking-[-0.055em] sm:text-6xl">How it works.</h2><p class="max-w-xs text-sm leading-6 text-(--muted)">Everyone joins the same room and adds songs to the queue.</p></div>
   <ol class="mt-12 grid gap-8 md:grid-cols-3">
    {#each [{ number: '01', symbol: '↗', title: 'Start a room.', copy: 'Send the room link to your friends so they can join.' }, { number: '02', symbol: '♫', title: 'Add a song.', copy: 'Paste a song link. Partyroom removes the vocals and syncs the lyrics.' }, { number: '03', symbol: '✳', title: 'Sing along.', copy: 'Follow the lyrics on screen. Your friends can queue up the next song while you sing.' }] as step}
     <li class="border-t border-(--line) pt-5"><div class="flex items-center justify-between"><span class="font-mono text-xs text-(--muted)">/{step.number}</span><span class="text-4xl text-(--purple)" aria-hidden="true">{step.symbol}</span></div><h3 class="font-heading mt-6 text-xl font-bold tracking-tight">{step.title}</h3><p class="mt-3 max-w-sm text-sm leading-6 text-(--muted)">{step.copy}</p></li>
    {/each}
   </ol>
  </section>
  <section id="invite" aria-labelledby="invite-heading" class="scroll-mt-6 border-y border-(--line) bg-(--surface)">
   <div class="mx-auto grid max-w-[1440px] gap-10 px-6 py-16 sm:px-12 lg:grid-cols-2 lg:gap-24 lg:px-20 lg:py-24">
    <div><p class="mb-5 text-xs font-bold tracking-[0.15em] uppercase">Early access</p><h2 id="invite-heading" class="font-heading text-5xl leading-[0.98] font-extrabold tracking-[-0.06em] sm:text-7xl">Join the<br />party</h2><p class="mt-6 max-w-sm text-base leading-7 text-(--muted)">Partyroom is in early access. Leave your name and email, and we’ll send you an invite when it’s ready.</p><p class="mt-8 text-5xl" aria-hidden="true">↘</p></div>
    <div class="rounded-2xl border border-(--line) bg-(--room) p-6 sm:p-8">
					{#if form?.joined}
						<div
							class="rounded-2xl border border-(--line) bg-(--surface) p-5"
							role="status"
						>
							<p class="font-medium text-(--foreground)">
								You&apos;re on the list.
							</p>
							<p class="mt-1 text-sm text-(--muted)">
								We&apos;ll email you when your invite is ready.
							</p>
						</div>
					{:else}
						<form
							method="POST"
							action="?/join"
							class="space-y-4"
							use:enhance
							data-sveltekit-noscroll
						>
							<label class="block">
								<span
									class="mb-2 block text-sm font-medium text-(--foreground)"
									>Name</span
								>
								<input
									name="name"
									type="text"
									autocomplete="name"
									required
									maxlength="100"
									value={name}
									class="h-12 w-full rounded-lg border border-(--line) bg-(--room) px-4 text-base text-(--foreground) placeholder:text-(--muted) focus:border-(--foreground) focus:ring-2 focus:ring-(--purple) focus:outline-none"
									placeholder="Your name"
								/>
							</label>

							<label class="block">
								<span
									class="mb-2 block text-sm font-medium text-(--foreground)"
									>Email</span
								>
								<input
									name="email"
									type="email"
									autocomplete="email"
									inputmode="email"
									required
									maxlength="254"
									value={email}
									class="h-12 w-full rounded-lg border border-(--line) bg-(--room) px-4 text-base text-(--foreground) placeholder:text-(--muted) focus:border-(--foreground) focus:ring-2 focus:ring-(--purple) focus:outline-none"
									placeholder="you@example.com"
								/>
							</label>

							{#if form?.joinError}
								<p class="text-sm text-(--error)" role="alert">
									{form.joinError}
								</p>
							{/if}

							<button
								type="submit"
								class="h-12 w-full rounded-lg bg-(--purple) px-5 font-semibold text-(--room) transition hover:bg-(--purple)/80 focus:ring-2 focus:ring-(--foreground) focus:ring-offset-2 focus:ring-offset-(--room) focus:outline-none"
							>
								Join the list
							</button>
						</form>
					{/if}

					<div class="my-7 h-px bg-(--line)"></div>

					<details
						id="access"
						class="group scroll-mt-8"
						open={accessOpen || Boolean(form?.accessError || accessRequired)}
					>
						<summary
							class="cursor-pointer list-none text-center text-sm font-medium text-(--muted) transition hover:text-(--foreground) [&::-webkit-details-marker]:hidden"
						>
							<span class="border-b border-(--muted) pb-0.5"
								>Have an access code?</span
							>
						</summary>
						<div class="mt-5">
							{@render accessCodeForm("access-code")}
						</div>
					</details>
    </div>
   </div>
  </section>
 </main>
 <footer class="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-8 sm:px-12 lg:px-20"><a href="/" class="text-xl font-semibold tracking-tight">Partyroom</a><p class="text-xs text-(--muted)">Karaoke with friends, wherever you are.</p><a href="#headline" class="text-xs underline underline-offset-4">Back to the top ↑</a></footer>
</div>
