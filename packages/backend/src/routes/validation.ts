import { z } from 'zod';

/**
 * Zod schemas for request body validation.
 * These define the allowed shapes for API requests and provide
 * type-safe parsing with clear error messages.
 */

const serverTypes = ['vanilla', 'paper', 'fabric', 'forge'] as const;

export const createServerSchema = z.object({
  name: z.string()
    .min(1, 'Server name is required')
    .max(100, 'Server name must be 100 characters or less')
    .trim(),
  type: z.enum(serverTypes).default('vanilla'),
  mcVersion: z.string()
    .min(1, 'Minecraft version is required'),
  port: z.number()
    .int('Port must be an integer')
    .min(1024, 'Port must be 1024 or higher')
    .max(65535, 'Port must be 65535 or lower')
    .optional()
    .default(25565),
  jvmArgs: z.string()
    .optional()
    .default('-Xmx2G -Xms1G'),
  javaPath: z.string()
    .optional()
    .default('java'),
  existingJarPath: z.string()
    .optional(),
});

export const updateServerSchema = z.object({
  name: z.string()
    .min(1, 'Server name cannot be empty')
    .max(100, 'Server name must be 100 characters or less')
    .trim()
    .optional(),
  port: z.number()
    .int('Port must be an integer')
    .min(1024, 'Port must be 1024 or higher')
    .max(65535, 'Port must be 65535 or lower')
    .optional(),
  jvmArgs: z.string()
    .optional(),
  javaPath: z.string()
    .optional(),
  autoStart: z.boolean()
    .optional(),
  jarPath: z.string()
    .optional(),
});

export const updatePropertiesSchema = z.object({
  properties: z.record(
    z.string().min(1, 'Property key cannot be empty'),
    z.string(),
  ),
});

export type CreateServerBody = z.infer<typeof createServerSchema>;
export type UpdateServerBody = z.infer<typeof updateServerSchema>;
export type UpdatePropertiesBody = z.infer<typeof updatePropertiesSchema>;
