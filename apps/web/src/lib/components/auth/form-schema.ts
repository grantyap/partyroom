import z from "zod";

const passwordSchema = z.string();
const passwordWithMinimumSchema = passwordSchema.min(
  8,
  "Passwords must be at least 8 characters long",
);

export const loginSchema = z.object({
  email: z.email(),
  password: passwordWithMinimumSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordWithMinimumSchema.max(128, "Passwords must be at most 128 characters long"),
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const signUpSchema = z
  .object({
    fullName: z.string().min(2, "Minimum 2 characters"),
    email: z.email(),
    password: passwordWithMinimumSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
