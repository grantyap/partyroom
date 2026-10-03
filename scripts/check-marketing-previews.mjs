// Run in the Codex computer-use REPL with a tab open at the marketing page:
// const { checkMarketingPreviews } = await import("/Users/grant/Documents/Repositories/partyroom/scripts/check-marketing-previews.mjs");
// await checkMarketingPreviews(previewTab);
import assert from "node:assert/strict";

export async function checkMarketingPreviews(tab) {
	const button = (name) => tab.playwright.getByRole("button", { name, exact: true });
	const words = (selector) => tab.playwright.locator(selector).evaluateAll(
		(elements) => JSON.stringify(elements.map((element) => element.getAttribute("data-lyric-word"))),
	);
	await tab.playwright.locator("#lyric-preview [role=slider]").press("End");
	assert.equal(await words('[aria-label="Karaoke visual preview"] [data-lyric-word]'), JSON.stringify(Array(6).fill("complete")));
	await tab.playwright.locator("#lyric-preview [role=slider]").press("Home");
	assert.equal(await words('[aria-label="Karaoke visual preview"] [data-lyric-word]'), JSON.stringify(["current", ...Array(5).fill("upcoming")]));
	assert.equal(await button("Bring vocals back").count(), 0);
	assert.equal(await button("Remove vocals").count(), 0);
	assert.equal(await tab.playwright.getByText("Opens the room on your phone.", { exact: true }).count(), 1);
	await button("Invite Alex").click();
	assert.equal(await tab.playwright.getByText("You’re in, Alex.", { exact: true }).isVisible(), true);
	await button("Reset").click();
	assert.equal(await button("Invite Alex").isVisible(), true);
	await tab.playwright.locator("#room-preview [role=slider]").press("End");
	assert.equal(await words(".paired-screens [data-lyric-word]"), JSON.stringify(Array(12).fill("complete")));
	await button("Queue an encore").click();
	assert.equal(await button("Queue 2").isVisible(), true);
	await button("Chat").click();
	assert.equal(await button("Send").isEnabled(), false);
	await tab.playwright.getByRole("textbox", { name: "Preview chat message", exact: true }).fill("  Count me in! <3  ");
	await button("Send").click();
	assert.equal(await tab.playwright.locator(".chat-message.own").innerText({}), "You Count me in! <3");
	assert.equal(await button("Send").isEnabled(), false);
	await button("Queue 2").click();
	assert.equal(await tab.playwright.getByText("The encore", { exact: true }).isVisible(), true);
	await button("Reset queue").click();
	assert.equal(await button("Queue 1").isVisible(), true);
	assert.equal(await tab.playwright.locator(".paired-screens .demo-lyrics").evaluateAll(
		(elements) => elements.every((element) => element.scrollWidth <= element.clientWidth),
	), true, "Lyrics must fit each screen at the current viewport width");
	assert.equal(await tab.playwright.evaluate(
		() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
	), true, "The page must not overflow horizontally");
}
