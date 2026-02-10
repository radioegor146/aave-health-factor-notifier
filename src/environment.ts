import Decimal from 'decimal.js'
import timestring from 'timestring'
import { z } from 'zod'

const environmentType = z.object({
  CHAIN_ID: z.string().default('1').transform(value => Number.parseInt(value)),
  CHECK_ADDRESS: z.string(),
  CRITICAL_LEVEL: z.string().default('1.7').transform(Decimal),
  CRITITAL_DELTA: z.string().default('1').transform(Decimal),
  MARKET_ADDRESS: z.string().default('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2'),
  RECHECK_INTERVAL: z.string().default('1m').transform(value => timestring(value, 'ms')),
  TELEGRAM_BOT_CHAT_ID: z.string(),
  TELEGRAM_BOT_TOKEN: z.string(),
  WARNING_DELTA: z.string().default('0.5').transform(Decimal),
  WARNING_LEVEL: z.string().default('2.5').transform(Decimal)
})

export type Environment = z.infer<typeof environmentType>

export function getEnvironment (): Environment {
  return environmentType.parse(process.env)
}
