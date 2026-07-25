import { v, type Validator } from "convex/values";

export type ArtifactId = string & { readonly __artifactId: unique symbol };
export type ArtifactDisposition = "intermediate" | "retained";

export type WireSchema =
  | { readonly kind: "string" }
  | {
      readonly kind: "artifact";
      readonly disposition: ArtifactDisposition;
    }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "optional"; readonly value: WireSchema }
  | { readonly kind: "array"; readonly value: WireSchema }
  | {
      readonly kind: "object";
      readonly fields: Readonly<Record<string, WireSchema>>;
    };

export type WireInfer<Schema extends WireSchema> = Schema extends {
  kind: "string";
}
  ? string
  : Schema extends { kind: "artifact" }
    ? ArtifactId
    : Schema extends { kind: "number" }
      ? number
      : Schema extends { kind: "boolean" }
        ? boolean
        : Schema extends {
              kind: "optional";
              value: infer Value extends WireSchema;
            }
          ? WireInfer<Value> | undefined
          : Schema extends {
                kind: "array";
                value: infer Value extends WireSchema;
              }
            ? WireInfer<Value>[]
            : Schema extends {
                  kind: "object";
                  fields: infer Fields extends Readonly<Record<string, WireSchema>>;
                }
              ? {
                  [Key in keyof Fields as Fields[Key] extends { kind: "optional" }
                    ? never
                    : Key]: WireInfer<Fields[Key]>;
                } & {
                  [Key in keyof Fields as Fields[Key] extends { kind: "optional" }
                    ? Key
                    : never]?: Exclude<WireInfer<Fields[Key]>, undefined>;
                }
              : never;

const string = { kind: "string" } as const;
const number = { kind: "number" } as const;
const boolean = { kind: "boolean" } as const;

export const wire = {
  string,
  artifact: <const Disposition extends ArtifactDisposition>(disposition: Disposition) =>
    ({ kind: "artifact", disposition }) as const,
  number,
  boolean,
  optional: <const Schema extends WireSchema>(value: Schema) =>
    ({ kind: "optional", value }) as const,
  array: <const Schema extends WireSchema>(value: Schema) => ({ kind: "array", value }) as const,
  object: <const Fields extends Readonly<Record<string, WireSchema>>>(fields: Fields) =>
    ({ kind: "object", fields }) as const,
};

export function wireValidator<const Schema extends WireSchema>(
  schema: Schema,
): Validator<WireInfer<Schema>, "required", any> {
  return toValidator(schema) as Validator<WireInfer<Schema>, "required", any>;
}

export type WireArtifactDefinitions<Schema extends WireSchema> = Schema extends {
  kind: "object";
  fields: infer Fields extends Readonly<Record<string, WireSchema>>;
}
  ? {
      readonly [Key in keyof Fields as Fields[Key] extends {
        kind: "artifact";
      }
        ? Key
        : never]: Fields[Key] extends {
        kind: "artifact";
        disposition: infer Disposition extends ArtifactDisposition;
      }
        ? { readonly disposition: Disposition }
        : never;
    }
  : {};

export function wireArtifactDefinitions<const Schema extends WireSchema>(
  schema: Schema,
): WireArtifactDefinitions<Schema> {
  if (schema.kind !== "object") return {} as WireArtifactDefinitions<Schema>;
  return Object.fromEntries(
    Object.entries(schema.fields)
      .filter(([, value]) => value.kind === "artifact")
      .map(([name, value]) => [
        name,
        {
          disposition: value.kind === "artifact" ? value.disposition : "intermediate",
        },
      ]),
  ) as WireArtifactDefinitions<Schema>;
}

function toValidator(schema: WireSchema): Validator<any, any, any> {
  switch (schema.kind) {
    case "string":
      return v.string();
    case "artifact":
      return v.string();
    case "number":
      return v.number();
    case "boolean":
      return v.boolean();
    case "optional":
      return v.optional(toValidator(schema.value));
    case "array":
      return v.array(toValidator(schema.value));
    case "object":
      return v.object(
        Object.fromEntries(
          Object.entries(schema.fields).map(([name, value]) => [name, toValidator(value)]),
        ),
      );
  }
}
