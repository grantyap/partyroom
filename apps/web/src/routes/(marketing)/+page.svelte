<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import partyroomLogo from "$lib/assets/icons/Partyroom logo.svg";
	import ArrowUpRightIcon from "@lucide/svelte/icons/arrow-up-right";
	import type { PageProps } from "./$types";

	const { form }: PageProps = $props();
	const name = $derived(form && "name" in form ? form.name : "");
	const email = $derived(form && "email" in form ? form.email : "");
	const code = $derived(form && "code" in form ? form.code : "");
	const accessRequired = $derived(
		page.url.searchParams.get("access") === "required",
	);
</script>

<svelte:head>
	<title>Partyroom - Karaoke at your place</title>
	<meta
		name="description"
		content="Pick songs with friends, follow the lyrics, and sing along in your browser. Join the Partyroom early access list."
	/>
</svelte:head>

<div
	data-marketing-page
	class="min-h-svh bg-(--marketing-background) text-(--marketing-foreground) [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-6 [&_a:focus-visible]:outline-current [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-offset-6 [&_summary:focus-visible]:outline-current"
	style="
		--marketing-font: 'Playfair Display Variable', Georgia, serif;
		--marketing-foreground: color-mix(in oklch, var(--primary) 2%, oklch(0.97 0.015 85));
		--marketing-copy: color-mix(in oklch, var(--marketing-foreground) 82%, var(--marketing-background));
		--marketing-muted: color-mix(in oklch, var(--marketing-foreground) 70%, var(--marketing-background));
		--marketing-rule: color-mix(in oklch, var(--marketing-foreground) 15%, transparent);
		--marketing-link-rule: color-mix(in oklch, var(--marketing-foreground) 30%, transparent);
		--marketing-poster: color-mix(in oklch, var(--primary) 32%, oklch(0.97 0.01 310));
		--marketing-ink: color-mix(in oklch, var(--primary) 18%, oklch(0.24 0.015 310));
		--marketing-shadow: color-mix(in oklch, var(--marketing-background) 50%, transparent);
		--marketing-poster-rule: color-mix(in oklch, var(--marketing-ink) 33%, transparent);
		--marketing-orbit: color-mix(in oklch, var(--marketing-foreground) 47%, transparent);
		--marketing-orbit-middle: color-mix(in oklch, var(--marketing-foreground) 33%, transparent);
		--marketing-orbit-outer: color-mix(in oklch, var(--marketing-foreground) 27%, transparent);
		--marketing-orbit-shadow: 0 0 0 28px var(--marketing-poster), 0 0 0 29px var(--marketing-orbit-middle), 0 0 0 57px var(--marketing-poster), 0 0 0 58px var(--marketing-orbit-outer);
		--marketing-accent: oklch(0.91 0.085 125);
		--marketing-accent-ink: oklch(0.3 0.035 125);
		--marketing-accent-hover: color-mix(in oklch, var(--marketing-accent) 65%, oklch(1 0 0));
		--marketing-paper: color-mix(in oklch, var(--primary) 1%, oklch(0.95 0.015 85));
		--marketing-border: color-mix(in oklch, var(--marketing-ink) 18%, var(--marketing-paper));
		--marketing-highlight: color-mix(in oklch, var(--primary) 55%, var(--marketing-ink));
		--marketing-copy-subtle: color-mix(in oklch, var(--marketing-ink) 68%, var(--marketing-paper));
		--marketing-label: color-mix(in oklch, var(--marketing-ink) 87%, var(--marketing-paper));
		--marketing-callout-border: color-mix(in oklch, var(--marketing-accent-ink) 25%, var(--marketing-paper));
		--marketing-callout: color-mix(in oklch, var(--marketing-accent) 35%, var(--marketing-paper));
		--marketing-summary: var(--marketing-copy-subtle);
		--marketing-summary-border: color-mix(in oklch, var(--marketing-ink) 40%, var(--marketing-paper));
		--marketing-secondary-border: var(--marketing-summary-border);
		--marketing-secondary-ring: var(--marketing-highlight);
		--marketing-secondary-hover-border: var(--marketing-highlight);
		--marketing-secondary-hover: color-mix(in oklch, var(--primary) 8%, var(--marketing-paper));
		--marketing-button: color-mix(in oklch, var(--primary) 30%, var(--marketing-ink));
		--marketing-error: color-mix(in oklch, var(--destructive) 80%, oklch(0.25 0.08 25));
		--brand-input-background: color-mix(in oklch, var(--marketing-paper) 40%, oklch(1 0 0));
		--brand-placeholder: var(--marketing-copy-subtle);
		--brand-ring: color-mix(in oklch, var(--marketing-highlight) 20%, transparent);
		--brand-button-hover: color-mix(in oklch, var(--marketing-button) 85%, var(--marketing-paper));
		--brand-button-shadow: transparent;
		--brand-ring-offset: var(--marketing-paper);
	"
>
	<header
		class="mx-auto flex max-w-7xl items-center justify-between gap-6 border-b border-(--marketing-rule) px-6 py-6 sm:px-10"
	>
		<a
			href="/"
			class="flex items-center gap-3 text-xl font-semibold tracking-tight"
			aria-label="Partyroom home"
		>
			<img src={partyroomLogo} alt="" class="size-8 rounded-lg" />
			Partyroom
		</a>
		<a
			href="#invite"
			class="text-sm text-(--marketing-copy) underline decoration-(--marketing-link-rule) underline-offset-4 hover:text-(--marketing-foreground)"
			>Get early access <ArrowUpRightIcon
				class="inline-block size-4 shrink-0 align-text-bottom"
				aria-hidden="true"
			/></a
		>
	</header>

	<main>
		<section
			class="mx-auto grid max-w-7xl items-center gap-14 px-6 pt-16 pb-14 sm:px-10 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24"
			aria-labelledby="headline"
		>
			<div>
				<p
					class="mb-7 flex items-center gap-2.5 text-sm text-(--marketing-copy)"
				>
					<span
						class="size-1.5 rounded-full bg-(--marketing-accent)"
						aria-hidden="true"
					></span>Sing every. Song. Ever.
				</p>
				<h1
					id="headline"
					class="font-(family-name:--marketing-font) font-medium text-[clamp(3.5rem,7.4vw,6.5rem)] leading-[1.04] tracking-[-0.055em]"
				>
					Karaoke<br /><span class="text-(--marketing-poster)">anything.</span>
				</h1>
				<p
					class="mt-7 max-w-md text-lg leading-8 text-(--marketing-copy) text-pretty tracking-tight"
				>
					Paste any link and get instant karaoke. Vocals removed. Lyrics synced.
					Party started.
				</p>
				<a
					href="#invite"
					class="mt-9 inline-flex min-h-12 items-center gap-8 rounded-lg bg-(--marketing-accent) px-6 py-3 text-sm font-semibold text-(--marketing-accent-ink) transition-colors hover:bg-(--marketing-accent-hover)"
					>Join the early access list <ArrowUpRightIcon
						class="inline-block size-4 shrink-0 align-text-bottom"
						aria-hidden="true"
					/></a
				>
				<p class="mt-4 text-xs text-(--marketing-muted)">
					We’re inviting our first singers.
				</p>
			</div>

			<div
				class="relative mx-auto w-full max-w-[350px] px-[22px] pt-3 sm:max-w-[460px]"
				aria-hidden="true"
			>
				<div
					class="relative aspect-[0.82] rotate-4 overflow-hidden bg-(--marketing-poster) p-5 text-(--marketing-ink) shadow-[12px_16px_0_var(--marketing-shadow)] sm:p-6"
				>
					<div
						class="relative z-1 flex items-center justify-between border-b border-(--marketing-poster-rule) pb-3 text-[10px] font-semibold tracking-[0.1em]"
					>
						<span>PARTYROOM</span><span>VOL. 01</span>
					</div>
					<div
						class="absolute top-[14%] left-1/4 aspect-square w-[115%] rounded-full border border-(--marketing-orbit) shadow-(--marketing-orbit-shadow)"
					></div>
					<p
						class="relative mt-[18px] text-[clamp(60px,20vw,84px)] leading-[0.89] tracking-[-0.08em] sm:mt-[22px] sm:text-[clamp(88px,9vw,136px)] font-(family-name:--marketing-font) font-medium"
					>
						one<br /><span class="ml-[12%] italic">more</span><br />song.
					</p>
					<div
						class="absolute inset-x-5 bottom-5 z-1 flex items-center justify-between text-[8px] font-semibold tracking-[0.1em] sm:inset-x-6 sm:text-[10px]"
					>
						<span>THE LIVING ROOM SESSIONS</span>
						<ArrowUpRightIcon class="size-7 shrink-0" aria-hidden="true" />
					</div>
				</div>
				<div
					class="absolute right-0 bottom-[60px] grid aspect-square w-[108px] -rotate-12 place-content-center rounded-full bg-(--marketing-accent) text-center text-[11px] leading-[1.4] font-semibold text-(--marketing-accent-ink) sm:w-[126px] sm:text-[13px]"
				>
					Good company.<br />Maybe<br />good singing.
				</div>
				<p class="mt-[30px] text-center text-xs text-(--marketing-muted)">
					If your ears aren&apos;t ringing, you&apos;re doing it wrong.
				</p>
			</div>
		</section>

		<section class="mx-auto max-w-7xl px-6 sm:px-10" aria-label="How it works">
			<ol
				class="grid gap-7 border-t border-(--marketing-rule) py-9 md:grid-cols-3 md:gap-10"
			>
				<li class="flex gap-4">
					<span class="pt-1 font-mono text-xs text-(--marketing-muted)">01</span
					>
					<div>
						<h2 class="font-medium">Make room for everyone.</h2>
						<p class="mt-2 text-sm leading-6 text-(--marketing-muted)">
							Start a room and invite your friends.
						</p>
					</div>
				</li>
				<li class="flex gap-4">
					<span class="pt-1 font-mono text-xs text-(--marketing-muted)">02</span
					>
					<div>
						<h2 class="font-medium">Put your song on.</h2>
						<p class="mt-2 text-sm leading-6 text-(--marketing-muted)">
							Everyone can add to the shared queue.
						</p>
					</div>
				</li>
				<li class="flex gap-4">
					<span class="pt-1 font-mono text-xs text-(--marketing-muted)">03</span
					>
					<div>
						<h2 class="font-medium">Go for the high note.</h2>
						<p class="mt-2 text-sm leading-6 text-(--marketing-muted)">
							Follow the lyrics. Sing as loud as you like.
						</p>
					</div>
				</li>
			</ol>
		</section>

		<section
			id="invite"
			class="scroll-mt-6 bg-(--marketing-paper) text-(--marketing-ink)"
			aria-labelledby="invite-heading"
		>
			<div
				class="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:px-10 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16"
			>
				<div class="max-w-md">
					<p class="mb-5 text-sm text-(--marketing-highlight)">
						Take a sneak peek
					</p>
					<h2
						id="invite-heading"
						class="font-(family-name:--marketing-font) font-medium text-5xl leading-[1.1] tracking-[-0.04em] sm:text-6xl"
					>
						Save your<br />place in the room.
					</h2>
					<p
						class="mt-6 max-w-sm text-base leading-7 text-(--marketing-copy-subtle)"
					>
						Partyroom is still getting warmed up. Leave your email and
						we&apos;ll send you an invite when it&apos;s your turn.
					</p>
				</div>
				<div class="w-full max-w-lg lg:justify-self-end">
					{#if form?.joined}
						<div
							class="rounded-2xl border border-(--marketing-callout-border) bg-(--marketing-callout) p-5"
							role="status"
						>
							<p class="font-medium text-(--marketing-highlight)">
								You&apos;re on the list.
							</p>
							<p class="mt-1 text-sm text-(--marketing-copy-subtle)">
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
									class="mb-2 block text-sm font-medium text-(--marketing-label)"
									>Name</span
								>
								<input
									name="name"
									type="text"
									autocomplete="name"
									required
									maxlength="100"
									value={name}
									class="h-12 w-full rounded-lg border border-(--marketing-border) bg-(--brand-input-background) px-4 text-base text-(--marketing-ink) placeholder:text-(--brand-placeholder) focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
									placeholder="Your name"
								/>
							</label>

							<label class="block">
								<span
									class="mb-2 block text-sm font-medium text-(--marketing-label)"
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
									class="h-12 w-full rounded-lg border border-(--marketing-border) bg-(--brand-input-background) px-4 text-base text-(--marketing-ink) placeholder:text-(--brand-placeholder) focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
									placeholder="you@example.com"
								/>
							</label>

							{#if form?.joinError}
								<p class="text-sm text-(--marketing-error)" role="alert">
									{form.joinError}
								</p>
							{/if}

							<button
								type="submit"
								class="h-12 w-full rounded-lg bg-(--marketing-button) px-5 font-semibold text-(--marketing-paper) shadow-lg shadow-(color:--brand-button-shadow) transition hover:bg-(--brand-button-hover) focus:ring-2 focus:ring-(--marketing-highlight) focus:ring-offset-2 focus:ring-offset-(--brand-ring-offset) focus:outline-none"
							>
								Join the list
							</button>
						</form>
					{/if}

					<div class="my-7 h-px bg-(--marketing-border)"></div>

					<details
						id="access"
						class="group scroll-mt-8"
						open={Boolean(form?.accessError || accessRequired)}
					>
						<summary
							class="cursor-pointer list-none text-center text-sm font-medium text-(--marketing-summary) transition hover:text-(--marketing-ink) [&::-webkit-details-marker]:hidden"
						>
							<span class="border-b border-(--marketing-summary-border) pb-0.5"
								>Have an access code?</span
							>
						</summary>
						<form method="POST" action="?/access" class="mt-5 flex gap-2">
							<label class="sr-only" for="access-code">Access code</label>
							<input
								id="access-code"
								name="code"
								type="text"
								autocomplete="one-time-code"
								required
								maxlength="100"
								value={code}
								class="h-11 min-w-0 flex-1 rounded-lg border border-(--marketing-border) bg-(--brand-input-background) px-4 font-mono text-sm tracking-wider text-(--marketing-ink) placeholder:font-sans placeholder:tracking-normal placeholder:text-(--brand-placeholder) focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
								placeholder="Enter your code"
							/>
							<button
								type="submit"
								class="h-11 rounded-lg border border-(--marketing-secondary-border) px-4 text-sm font-semibold transition hover:border-(--marketing-secondary-hover-border) hover:bg-(--marketing-secondary-hover) focus:ring-2 focus:ring-(--marketing-secondary-ring) focus:outline-none"
							>
								Enter
							</button>
						</form>
						{#if form?.accessError}
							<p class="mt-3 text-sm text-(--marketing-error)" role="alert">
								{form.accessError}
							</p>
						{:else if accessRequired}
							<p
								class="mt-3 text-sm text-(--marketing-copy-subtle)"
								role="status"
							>
								Enter your access code to continue.
							</p>
						{/if}
					</details>
				</div>
			</div>
		</section>
	</main>

	<footer
		class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-7 text-xs text-(--marketing-muted) sm:px-10"
	>
		<span class="font-semibold text-(--marketing-foreground)">Partyroom</span>
		<span>See you after the song.</span>
	</footer>
</div>
