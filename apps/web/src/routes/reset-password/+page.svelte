<script lang="ts">
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { authClient } from "#lib/auth-client.js";
  import { resetPasswordSchema } from "#lib/components/auth/form-schema.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import * as Card from "#lib/components/ui/card/index.js";

  const token = $derived(page.url.searchParams.get("token"));
  let password = $state("");
  let confirmPassword = $state("");
  let busy = $state(false);
  let done = $state(false);
  let invalid = $state(false);
  let error = $state("");
  async function reset(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !token) return;
    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) { error = parsed.error.issues[0].message; return; }
    busy = true;
    error = "";
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") invalid = true;
        throw new Error("Password reset failed");
      }
      done = true;
      password = confirmPassword = "";
      replaceState("/reset-password", page.state);
    } catch {
      error = "We couldn’t reset your password. Try again or request a new link.";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Choose a new password · Partyroom</title><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="flex min-h-svh items-center justify-center bg-muted p-6">
  <Card.Root class="w-full max-w-sm">
    <Card.Header><Card.Title>Choose a new password</Card.Title></Card.Header>
    <Card.Content class="space-y-4">
      {#if done}
        <p role="status" class="text-sm">Your password has been reset. Sign in with your new password.</p>
        <Button href="/login">Go to login</Button>
      {:else if !token || invalid || page.url.searchParams.has("error")}
        <p role="alert" class="text-sm">This reset link has expired or doesn’t work.</p>
        <Button href="/forgot-password">Request a new link</Button>
      {:else}
        <form onsubmit={reset} class="space-y-4">
          <div class="space-y-2"><Label for="password">New password</Label><Input id="password" type="password" autocomplete="new-password" minlength={8} maxlength={128} required bind:value={password} /></div>
          <div class="space-y-2"><Label for="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autocomplete="new-password" minlength={8} maxlength={128} required bind:value={confirmPassword} /></div>
          {#if error}<p role="alert" class="text-sm text-destructive">{error}</p><a href="/forgot-password" class="block text-sm underline">Request a new link</a>{/if}
          <Button type="submit" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</Button>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
