import { describe, expect, test } from "vitest";
import { parse } from "convex-helpers/validators";
import { type Infer } from "convex/values";
import { wire, wireValidator } from "./wire";

describe("wire schemas", () => {
  test("share static and runtime object shapes", () => {
    const schema = wire.object({
      sourceId: wire.string,
      duration: wire.optional(wire.number),
      tags: wire.array(wire.string),
    });
    const validator = wireValidator(schema);

    expect(parse(validator, { sourceId: "abc", tags: ["music"] })).toEqual({
      sourceId: "abc",
      tags: ["music"],
    });
    const typed: Infer<typeof validator> = {
      sourceId: "abc",
      tags: ["music"],
    };
    expect(typed.sourceId).toBe("abc");
  });
});
