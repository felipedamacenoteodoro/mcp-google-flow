import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const MB = 1024 * 1024;

const absolutePath = z
  .string()
  .transform((p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p))
  .refine(isAbsolute, 'must be an absolute path')
  .transform((p) => resolve(p));

const envSchema = z.object({
  FLOW_MCP_HOME: absolutePath.default(join(homedir(), '.flow-studio-mcp')),
  FLOW_MCP_OUTPUT_DIR: absolutePath.default(join(homedir(), 'FlowStudio', 'output')),
  FLOW_MCP_INPUT_DIRS: z
    .string()
    .default(join(homedir(), 'FlowStudio', 'input'))
    .transform((value) => value.split(delimiter).filter(Boolean))
    .pipe(z.array(absolutePath).min(1)),
  FLOW_MCP_MAX_CREDITS: z.coerce.number().int().min(0).max(100_000).default(100),
  FLOW_MCP_FALLBACK_CREDITS: z.coerce.number().int().min(1).max(1000).default(20),
  FLOW_MCP_PAID_PER_HOUR: z.coerce.number().int().min(1).max(500).default(10),
  FLOW_MCP_MIN_SECONDS_BETWEEN_PAID: z.coerce.number().int().min(0).max(3600).default(45),
  FLOW_MCP_MAX_IMAGE_MB: z.coerce.number().positive().max(200).default(20),
  FLOW_MCP_MAX_VIDEO_MB: z.coerce.number().positive().max(2000).default(500),
  FLOW_MCP_SUBMIT: z.enum(['auto', 'manual']).default('auto'),
  FLOW_MCP_LANGUAGE: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'use a language code such as en or pt-BR').optional(),
  FLOW_MCP_CHROME_PATH: absolutePath.optional(),
  FLOW_MCP_CDP_URL: z.string().optional(),
  FLOW_MCP_UI_LABELS: absolutePath.optional(),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    profileDir: join(e.FLOW_MCP_HOME, 'chrome-profile'),
    outputDir: e.FLOW_MCP_OUTPUT_DIR,
    inputDirs: e.FLOW_MCP_INPUT_DIRS,
    maxCredits: e.FLOW_MCP_MAX_CREDITS,
    fallbackCredits: e.FLOW_MCP_FALLBACK_CREDITS,
    paidPerHour: e.FLOW_MCP_PAID_PER_HOUR,
    minMsBetweenPaid: e.FLOW_MCP_MIN_SECONDS_BETWEEN_PAID * 1000,
    maxImageBytes: e.FLOW_MCP_MAX_IMAGE_MB * MB,
    maxVideoBytes: e.FLOW_MCP_MAX_VIDEO_MB * MB,
    submitMode: e.FLOW_MCP_SUBMIT,
    language: e.FLOW_MCP_LANGUAGE ?? null,
    chromePath: e.FLOW_MCP_CHROME_PATH,
    cdpUrl: e.FLOW_MCP_CDP_URL,
    uiLabelsPath: e.FLOW_MCP_UI_LABELS,
  };
}
