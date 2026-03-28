import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(255);
export const passwordSchema = z.string().min(6).max(255);
export const nameSchema = z.string().trim().max(255).optional().nullable();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(255),
});

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    name: z.string().trim().max(255).optional(),
    role: z.enum(["admin", "user"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
