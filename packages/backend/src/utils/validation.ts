import { z } from "zod";
import { ValidationError } from "./errors.js";

/**
 * Validate input against a Zod schema.
 * Returns the parsed (typed) data on success.
 * Throws ValidationError with formatted message on failure.
 */
export function validate<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}
