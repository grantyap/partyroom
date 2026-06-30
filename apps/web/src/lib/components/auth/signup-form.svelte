<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Card from "$lib/components/ui/card/index.js";
	import * as Field from "$lib/components/ui/field/index.js";
	import * as Form from "$lib/components/ui/form";
	import { Input } from "$lib/components/ui/input/index.js";
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { type SuperForm } from "sveltekit-superforms";
	import type { Infer } from "zod";
	import type { signUpSchema } from "./form-schema";

	let {
		form,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		form: SuperForm<Infer<typeof signUpSchema>>;
	} = $props();

	// svelte-ignore state_referenced_locally
	const { form: formData, errors, message, enhance } = form;

	const errorMessages = $derived(
		[$message ?? undefined, $errors._errors].filter((v) => !!v),
	);
</script>

<div class={cn("flex flex-col gap-6", className)} {...restProps}>
	<Card.Root>
		<Card.Header class="text-center">
			<Card.Title class="text-xl">Create your account</Card.Title>
			<Card.Description
				>Enter your email below to create your account</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<form method="POST" use:enhance>
				<Field.Group>
					<Form.Field {form} name="fullName">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Full Name</Form.Label>
								<Input
									{...props}
									type="text"
									placeholder="John Doe"
									required
									autocomplete="name"
									bind:value={$formData.fullName}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="email">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Email</Form.Label>
								<Input
									{...props}
									type="email"
									placeholder="m@example.com"
									required
									autocomplete="email"
									bind:value={$formData.email}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Field.Field>
						<Field.Field class="grid grid-cols-2 gap-4">
							<Form.Field {form} name="password">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>Password</Form.Label>
										<Input
											{...props}
											type="password"
											required
											autocomplete="new-password"
											bind:value={$formData.password}
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
							<Form.Field {form} name="confirmPassword">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>Confirm Password</Form.Label>
										<Input
											{...props}
											type="password"
											required
											autocomplete="new-password"
											bind:value={$formData.confirmPassword}
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</Field.Field>
					</Field.Field>
					<Field.Field>
						{#if errorMessages.length > 0}
							<ul>
								{#each errorMessages as error}
									<li class="text-sm text-destructive">
										{error}
									</li>
								{/each}
							</ul>
						{/if}
						<Button type="submit">Create Account</Button>
						<Field.Description class="text-center">
							Already have an account? <a href="/login">Sign in</a>
						</Field.Description>
					</Field.Field>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>
	<Field.Description class="px-6 text-center">
		By clicking continue, you agree to our <a href="#/">Terms of Service</a>
		and <a href="#/">Privacy Policy</a>.
	</Field.Description>
</div>
