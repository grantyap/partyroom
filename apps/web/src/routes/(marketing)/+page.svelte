<script lang="ts">
	import { page } from "$app/state";
	import partyroomLogo from "$lib/assets/icons/Partyroom logo.svg";
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
	<title>Partyroom - Early access</title>
	<meta
		name="description"
		content="Join the Partyroom early access list and turn any screen into a shared karaoke room."
	/>
</svelte:head>

<div
	class="relative isolate min-h-svh overflow-hidden bg-(--marketing-background) text-(--marketing-foreground)"
	style="
		--marketing-background: color-mix(in oklch, var(--primary) 8%, black);
		--marketing-foreground: color-mix(in oklch, var(--primary) 4%, white);
		--marketing-highlight: color-mix(in oklch, var(--primary) 55%, white);
		--marketing-border: color-mix(in oklch, var(--marketing-foreground) 10%, transparent);
		--marketing-copy: color-mix(in oklch, var(--marketing-foreground) 65%, transparent);
		--marketing-copy-subtle: color-mix(in oklch, var(--marketing-foreground) 55%, transparent);
		--marketing-features: color-mix(in oklch, var(--marketing-foreground) 50%, transparent);
		--marketing-card: color-mix(in oklch, var(--marketing-foreground) 6%, transparent);
		--marketing-shadow: color-mix(in oklch, black 30%, transparent);
		--marketing-callout-border: color-mix(in oklch, var(--primary) 20%, transparent);
		--marketing-callout: color-mix(in oklch, var(--primary) 10%, transparent);
		--marketing-label: color-mix(in oklch, var(--marketing-foreground) 80%, transparent);
		--brand-glow-main: color-mix(in oklch, var(--primary) 20%, transparent);
		--brand-glow-secondary: color-mix(in oklch, var(--primary) 15%, transparent);
		--brand-shadow: color-mix(in oklch, var(--primary) 25%, transparent);
		--brand-ring: color-mix(in oklch, var(--primary) 20%, transparent);
		--brand-input-background: color-mix(in oklch, black 20%, transparent);
		--brand-placeholder: color-mix(in oklch, var(--marketing-foreground) 25%, transparent);
		--brand-button-hover: color-mix(in oklch, var(--primary) 85%, white);
		--brand-button-shadow: color-mix(in oklch, var(--primary) 20%, transparent);
		--brand-ring-offset: color-mix(in oklch, var(--primary) 12%, black);
		--marketing-summary: color-mix(in oklch, var(--marketing-foreground) 60%, transparent);
		--marketing-summary-border: color-mix(in oklch, var(--marketing-foreground) 25%, transparent);
		--marketing-secondary-border: color-mix(in oklch, var(--marketing-foreground) 15%, transparent);
		--marketing-secondary-ring: color-mix(in oklch, var(--marketing-foreground) 40%, transparent);
		--marketing-secondary-hover-border: color-mix(in oklch, var(--marketing-foreground) 30%, transparent);
		--marketing-secondary-hover: color-mix(in oklch, var(--marketing-foreground) 10%, transparent);
	"
>
	<div
		class="pointer-events-none absolute inset-x-0 top-[-22rem] mx-auto h-[44rem] max-w-5xl rounded-full bg-(--brand-glow-main) blur-[120px]"
	></div>
	<div
		class="pointer-events-none absolute right-[-12rem] bottom-[-16rem] h-[34rem] w-[34rem] rounded-full bg-(--brand-glow-secondary) blur-[110px]"
	></div>

	<main
		class="relative mx-auto flex min-h-svh w-full max-w-6xl items-center px-5 py-12 sm:px-8"
	>
		<div
			class="grid w-full items-center gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20"
		>
			<section>
				<a
					href="/"
					class="mb-16 inline-flex items-center gap-3 font-semibold font-heading text-lg tracking-tight"
				>
					<img
						class="size-9 rounded-xl shadow-lg shadow-(color:--brand-shadow)"
						src={partyroomLogo}
						alt=""
					/>
					Partyroom
				</a>

				<p
					class="mb-5 text-sm font-semibold tracking-[0.2em] text-(--marketing-highlight) uppercase"
				>
					Early access
				</p>
				<h1
					class="max-w-3xl font-heading text-5xl leading-[0.98] font-semibold tracking-[-0.035em] text-balance sm:text-7xl"
				>
					Karaoke night,<br />without the machine.
				</h1>
				<p
					class="mt-7 max-w-xl text-lg leading-8 text-(--marketing-copy) sm:text-xl"
				>
					Bring the songs, lyrics, and queue together in one shared room. We’re
					inviting a small group of early testers now.
				</p>

				<div
					class="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-(--marketing-features)"
				>
					<span>Live shared queue</span>
					<span>Synchronized lyrics</span>
					<span>Any screen</span>
				</div>
			</section>

			<section
				class="rounded-3xl border border-(--marketing-border) bg-(--marketing-card) p-6 shadow-2xl shadow-(color:--marketing-shadow) backdrop-blur-xl sm:p-8"
			>
				<div class="mb-7">
					<h2 class="font-heading text-2xl font-semibold">Get an invite</h2>
					<p class="mt-2 text-sm leading-6 text-(--marketing-copy-subtle)">
						Tell us where to send your early access code.
					</p>
				</div>

				{#if form?.joined}
					<div
						class="rounded-2xl border border-(--marketing-callout-border) bg-(--marketing-callout) p-5"
						role="status"
					>
						<p class="font-medium text-(--marketing-highlight)">
							You’re on the list.
						</p>
						<p class="mt-1 text-sm text-(--marketing-copy-subtle)">
							We’ll be in touch when your invite is ready.
						</p>
					</div>
				{:else}
					<form method="POST" action="?/join" class="space-y-4">
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
								class="h-12 w-full rounded-xl border border-(--marketing-border) bg-(--brand-input-background) px-4 text-base text-(--marketing-foreground) placeholder:text-(--brand-placeholder) focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
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
								class="h-12 w-full rounded-xl border border-(--marketing-border) bg-(--brand-input-background) px-4 text-base text-(--marketing-foreground) placeholder:text-(--brand-placeholder) focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
								placeholder="you@example.com"
							/>
						</label>

						{#if form?.joinError}
							<p class="text-sm text-destructive" role="alert">
								{form.joinError}
							</p>
						{/if}

						<button
							type="submit"
							class="h-12 w-full rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-(color:--brand-button-shadow) transition hover:bg-(--brand-button-hover) focus:ring-2 focus:ring-(--marketing-highlight) focus:ring-offset-2 focus:ring-offset-(--brand-ring-offset) focus:outline-none"
						>
							Join the early access list
						</button>
					</form>
				{/if}

				<div class="my-7 h-px bg-(--marketing-border)"></div>

				<details
					class="group"
					open={Boolean(form?.accessError || accessRequired)}
				>
					<summary
						class="cursor-pointer list-none text-center text-sm font-medium text-(--marketing-summary) transition hover:text-(--marketing-foreground) [&::-webkit-details-marker]:hidden"
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
							class="h-11 min-w-0 flex-1 rounded-xl border border-(--marketing-border) bg-(--brand-input-background) px-4 font-mono text-sm tracking-wider text-(--marketing-foreground) uppercase placeholder:font-sans placeholder:tracking-normal placeholder:text-(--brand-placeholder) placeholder:normal-case focus:border-(--marketing-highlight) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none"
							placeholder="Enter your code"
						/>
						<button
							type="submit"
							class="h-11 rounded-xl border border-(--marketing-secondary-border) px-4 text-sm font-semibold transition hover:border-(--marketing-secondary-hover-border) hover:bg-(--marketing-secondary-hover) focus:ring-2 focus:ring-(--marketing-secondary-ring) focus:outline-none"
						>
							Enter
						</button>
					</form>
					{#if form?.accessError}
						<p class="mt-3 text-sm text-destructive" role="alert">
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
			</section>
		</div>
	</main>
</div>
