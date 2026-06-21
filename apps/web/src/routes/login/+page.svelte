<script lang="ts">
	import { authClient } from "$lib/auth-client";
	import LoginForm from "$lib/components/auth/login-form.svelte";
	import { loginSchema } from "$lib/components/auth/form-schema";
	import GalleryVerticalEndIcon from "@lucide/svelte/icons/gallery-vertical-end";
	import { setMessage, superForm } from "sveltekit-superforms";
	import { zod4 } from "sveltekit-superforms/adapters";
	import type { PageProps } from "./$types";
	import { goto } from "$app/navigation";

	const { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4(loginSchema),
		SPA: true,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				return;
			}

			const { email, password } = form.data;
			await authClient.signIn.email(
				{
					email,
					password,
				},
				{
					onError: ({ error }) => {
						setMessage(form, error.message);
					},
				},
			);
			await goto("/");
		},
	});
</script>

<div
	class="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10"
>
	<div class="flex w-full max-w-sm flex-col gap-6">
		<a
			href="##"
			class="flex items-center gap-2 self-center font-medium text-foreground"
		>
			<div
				class="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md"
			>
				<GalleryVerticalEndIcon class="size-4" />
			</div>
			Partyroom
		</a>
		<LoginForm {form} />
	</div>
</div>
