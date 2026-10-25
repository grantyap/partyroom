<script lang="ts">
  import { authClient } from "#lib/auth-client.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Label } from "#lib/components/ui/label/index.js";

  let email = $state("");
  let busy = $state(false);
  let sent = $state(false);
  let error = $state("");
  async function requestReset(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = "";
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      if (result.error) throw new Error("Reset request failed");
      sent = true;
    } catch {
      error = "We couldn’t request a reset link. Please try again.";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Reset your password · Partyroom</title></svelte:head>
<main class="flex min-h-svh items-center justify-center bg-muted p-6">
  <Card.Root class="w-full max-w-sm">
    <Card.Header><Card.Title>Reset your password</Card.Title><Card.Description>Enter your account email to request a reset link.</Card.Description></Card.Header>
    <Card.Content class="space-y-4">
      {#if sent}
        <p role="status" class="text-sm">If an account exists for that email, we’ve sent a password reset link. Check your inbox and spam folder. The link expires in one hour.</p>
        <Button variant="outline" onclick={() => sent = false}>Request another link</Button>
      {:else}
        <form onsubmit={requestReset} class="space-y-4">
          <div class="space-y-2"><Label for="email">Email</Label><Input id="email" type="email" autocomplete="email" required bind:value={email} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Requesting…" : "Send reset link"}</Button>
        </form>
      {/if}
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <a href="/login" class="block text-sm underline underline-offset-4">Back to login</a>
    </Card.Content>
  </Card.Root>
</main>
