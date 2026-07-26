<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { authClient } from "$lib/auth-client";
	import { signUpSchema } from "$lib/components/auth/form-schema";
	import SignupForm from "$lib/components/auth/signup-form.svelte";
	import GalleryVerticalEndIcon from "@lucide/svelte/icons/gallery-vertical-end";
	import { superForm } from "sveltekit-superforms";
	import { zod4 } from "sveltekit-superforms/adapters";
	import type { PageProps } from "./$types";

	const { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4(signUpSchema),
		SPA: true,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				return;
			}

			const { fullName, email, password } = form.data;

			const result = await authClient.signUp.email({
				name: fullName,
				email,
				password,
			});

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
			href="#/"
			class="flex items-center gap-2 self-center font-medium text-foreground"
		>
			<div
				class="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md"
			>
				<GalleryVerticalEndIcon class="size-4" />
			</div>
			Partyroom
		</a>
		<SignupForm {form} />
	</div>
</div>
