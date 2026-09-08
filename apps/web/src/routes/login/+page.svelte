<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { authClient } from "$lib/auth-client";
	import partyroomLogo from "$lib/assets/icons/Partyroom logo.svg";
	import { loginSchema } from "$lib/components/auth/form-schema";
	import LoginForm from "$lib/components/auth/login-form.svelte";
	import { setMessage, superForm } from "sveltekit-superforms";
	import { zod4 } from "sveltekit-superforms/adapters";
	import type { PageProps } from "./$types";

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
			const result = await authClient.signIn.email(
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

			if (result.data) {
				const target = page.url.searchParams.get("to") || "/app";
				await goto(target);
			}
		},
		resetForm: false,
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
			<img class="size-6 rounded-md" src={partyroomLogo} alt="" />
			Partyroom
		</a>
		<LoginForm {form} />
	</div>
</div>
