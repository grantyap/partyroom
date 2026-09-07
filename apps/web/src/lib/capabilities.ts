import { capabilities, type Capability } from "@partyroom/capabilities";

export { capabilities } from "@partyroom/capabilities";
export type { Capability } from "@partyroom/capabilities";

type UserWithCapabilities = {
	capabilities?: readonly Capability[] | null;
} | null | undefined;

export function hasCapability(
	user: UserWithCapabilities,
	capability: Capability,
) {
	return user?.capabilities?.includes(capability) ?? false;
}
