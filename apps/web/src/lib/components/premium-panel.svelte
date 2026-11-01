<script lang="ts">
	import AnchorHighlight from "#lib/components/anchor-highlight.svelte";
	import CheckIcon from "@lucide/svelte/icons/check";
	import MailIcon from "@lucide/svelte/icons/mail";
	import { refreshAll } from "$app/navigation";
	import { SearchParams } from "#lib/hooks/search-params.svelte.js";
	import { authClient } from "#lib/auth-client.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
	import { api } from "@partyroom/backend/convex/_generated/api.js";
	import { useAction, useQuery } from "convex-svelte";

	let { settingsPage = false }: { settingsPage?: boolean } = $props();
	const query = new SearchParams({ billing: null, error: null });
	const auth = useAuth();
	const user = useQuery(api.auth.getCurrentUser, () => auth.isAuthenticated ? {} : "skip");
	const billing = useQuery(api.billing.status, () => auth.isAuthenticated ? {} : "skip");
	const portal = useAction(api.billing.portal);
	const linkImportedCustomer = useAction(api.billingStripe.linkImportedCustomer);
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let claimAttemptedFor = $state<string | null>(null);
	let sentTo = $state<string | null>(null);
	let claimFailed = $state(false);
	const status = $derived(billing.data);
	const subscription = $derived(status?.subscription);
	const paymentFailed = $derived(subscription?.status === "past_due" || subscription?.status === "unpaid");
	const accessDate = $derived(status?.accessUntil ? new Date(status.accessUntil).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null);

	// Claim only an authenticated, verified association returned by the backend.
	// The Stripe metadata write is retryable; never infer a grant from a redirect.
	$effect(() => {
		if (status?.needsClaim && user.data?.emailVerified && !busy && claimAttemptedFor !== user.data._id) {
			claimAttemptedFor = user.data._id;
			void claim();
		}
	});

	async function claim() {
		if (busy) return;
		busy = "claim";
		error = null;
		claimFailed = false;
		try {
			await linkImportedCustomer({});
		} catch {
			claimFailed = true;
			error = "We couldn’t link your account. Try again to manage your account.";
		} finally {
			busy = null;
		}
	}

	async function openBilling() {
		if (busy) return;
		busy = "portal";
		error = null;
		try {
			const result = await portal({});
			if (!result.url) throw new Error("Billing settings are unavailable.");
			window.location.assign(result.url);
		} catch {
			error = "We couldn’t open billing settings. Please try again.";
		} finally {
			busy = null;
		}
	}

	async function verifyEmail() {
		if (busy || !user.data?.email) return;
		busy = "verify";
		error = null;
		try {
			const result = await authClient.sendVerificationEmail({ email: user.data.email, callbackURL: "/app/settings?verification=success#email" });
			if (result.error) throw new Error(result.error.message);
			sentTo = user.data.email;
			notice = `We sent a link to ${sentTo}. Open it to verify your email.`;
		} catch {
			error = "We couldn’t send your verification link. Please try again.";
		} finally {
			busy = null;
		}
	}

	async function refreshVerification() {
		if (busy) return;
		busy = "refresh";
		error = null;
		try {
			const result = await authClient.getSession({ query: { disableCookieCache: true } });
			if (result.error) throw new Error(result.error.message);
			await refreshAll({ includeLoadFunctions: true });
			notice = "Account refreshed. To verify your email, open the link we sent you.";
		} catch {
			error = "We couldn’t refresh your account. Please try again.";
		} finally {
			busy = null;
		}
	}
</script>

{#snippet verificationCard()}
	{#if !user.data?.emailVerified}
		<div class={settingsPage ? "space-y-3" : "rounded-2xl border border-border/60 bg-muted/40 p-4"}>
			<div class="flex items-start gap-3">
				<div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
					<MailIcon class="size-4" aria-hidden="true" />
				</div>
				<div class="min-w-0 flex-1 space-y-1">
					<h3 class="text-sm font-semibold">{sentTo === user.data?.email ? "Check your inbox" : "Verify your email"}</h3>
					<p class="text-sm text-muted-foreground">Verify your email to secure your account. Hosting is free during early access.</p>
					<p class="break-all text-sm text-muted-foreground">{user.data?.email}</p>
					<div class="flex flex-wrap items-center gap-1 pt-2">
						<Button size="sm" variant="outline" disabled={Boolean(busy)} onclick={verifyEmail}>{busy === "verify" ? "Sending…" : sentTo === user.data?.email ? "Resend link" : "Send link"}</Button>
						<Button size="sm" variant="ghost" class="text-muted-foreground" disabled={Boolean(busy)} onclick={refreshVerification}>{busy === "refresh" ? "Checking…" : "I’ve verified"}</Button>
					</div>
				</div>
			</div>
		</div>
	{:else if settingsPage}
		<div class="flex flex-wrap items-center gap-3"><p class="break-all text-sm text-muted-foreground">{user.data?.email}</p><span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"><CheckIcon class="size-3.5" aria-hidden="true" />Verified</span></div>
	{/if}
{/snippet}

{#snippet billingActions()}
	{#if status}
			<div class={settingsPage ? "flex flex-wrap gap-2" : "flex flex-col gap-2"}>
				{#if status.needsClaim || claimFailed}
					<Button disabled={Boolean(busy)} onclick={claim}>{busy === "claim" ? "Linking Premium…" : "Link Premium account"}</Button>

				{/if}
				{#if status.hasBillingAccount}
					<Button variant="outline" disabled={Boolean(busy) || status.needsClaim || claimFailed} onclick={openBilling}>{busy === "portal" ? "Opening billing…" : "Manage billing"}</Button>
				{/if}
				{#if query.current.billing === "success" && !status.premium}
					<Button onclick={() => query.update({ billing: "" }, { pushHistory: false })} variant="ghost">Return to billing</Button>
				{/if}
			</div>
	{/if}
{/snippet}

<div class="space-y-4">
		{#if billing.error || user.error}
			<p role="alert" class="text-sm text-destructive">We couldn’t load your account. Refresh the page to try again.</p>
		{:else if !status || !user.data}
			<p role="status" class="text-sm text-muted-foreground">Loading…</p>
		{:else}
			{#if settingsPage}
				<AnchorHighlight id="email" class="scroll-mt-32 md:scroll-mt-8">
					<section aria-labelledby="email-heading" class="grid gap-4 border-b py-6 sm:grid-cols-[10rem_1fr] sm:gap-8">
						<h3 id="email-heading" class="text-sm font-medium">Email verification</h3>
						<div>{@render verificationCard()}</div>
					</section>
				</AnchorHighlight>
				<AnchorHighlight id="billing" class="scroll-mt-32 md:scroll-mt-8">
					<section aria-labelledby="billing-heading" class="grid gap-4 py-6 sm:grid-cols-[10rem_1fr] sm:gap-8">
						<h3 id="billing-heading" class="text-sm font-medium">Billing</h3>
						<div>{@render billingDetails()}</div>
					</section>
				</AnchorHighlight>
			{:else}
				{@render verificationCard()}
				{@render billingDetails()}
			{/if}
		{/if}
		{#if query.current.error !== null}
			<p class="text-sm text-destructive" role="alert">That link has expired or doesn’t work. Send yourself a new one above.</p>
		{/if}
		{#if !settingsPage}<a href="/app/settings#account" class="block text-center text-sm text-muted-foreground underline underline-offset-4">Settings</a>{/if}
		{#if notice}<p class="text-sm text-muted-foreground" role="status">{notice}</p>{/if}
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
</div>

{#snippet billingDetails()}
	{#if status}
			<div aria-live="polite" class="space-y-2 text-sm">
				<p class="font-medium">Hosting is free during early access.</p>
				{#if paymentFailed}
					<p>Your payment didn’t go through. Update your payment details under Manage billing.</p>
				{:else if status.premium}
					<p>{subscription?.complimentary ? "Your account has complimentary Premium." : "You have Premium."}</p>
					{#if subscription?.cancelAtPeriodEnd}
						<p>Your subscription will end on {accessDate}.</p>
					{:else if subscription?.complimentary}
						<p>It renews automatically. You won’t be charged.</p>
					{:else}
						<p>Update your payment details or cancel below.</p>
					{/if}
				{:else if subscription}
					<p>Check your subscription under Manage billing.</p>
				{/if}
				{#if query.current.billing === "success" && !status.premium}
					<p role="status">Confirming your payment… This page will update when it’s ready. If it takes too long, check Manage billing before paying again.</p>
				{:else if query.current.billing === "success" && status.premium}
					<p role="status">{settingsPage ? "You’re all set. Head back to Rooms to start hosting." : "You’re all set. Close this window to create a room."}</p>
				{:else if query.current.billing === "canceled"}
					<p role="status">You haven’t been charged.</p>
				{/if}
			</div>

			{#if status.premium || subscription}
				{@render billingActions()}
			{/if}
	{/if}
{/snippet}
