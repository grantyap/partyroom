import { capabilities, type Capability } from "@partyroom/capabilities";

export { capabilities } from "@partyroom/capabilities";
export type { Capability, RoomPermission } from "@partyroom/capabilities";

export function isAnonymousUser(user: object | null) {
	return Boolean(user && "isAnonymous" in user && user.isAnonymous === true);
}

export function getCapabilities(user: object | null): readonly Capability[] {
	if (!user || isAnonymousUser(user)) {
		return [];
	}

	return [capabilities.rooms.list, capabilities.rooms.create];
}

export function requireCapability(
	user: object | null,
	capability: Capability,
) {
	if (!getCapabilities(user).includes(capability)) {
		throw new Error("Unauthorized");
	}
}
