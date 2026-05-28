import { z } from 'zod';

export const ServerConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    languagePacks: z.array(z.string()).optional(),
  })
]);

export type JsonServerConfig = z.infer<typeof ServerConfigSchema>;
