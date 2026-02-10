import 'dotenv/config'
import { AaveClient, chainId, evmAddress } from '@aave/client'
import { userMarketState } from '@aave/client/actions'
import Decimal from 'decimal.js'
import { Telegraf } from 'telegraf'

import { getEnvironment } from './environment'
import { getLogger } from './logger'

const logger = getLogger()
const environment = getEnvironment()

interface UserStatus {
  healthFactor: Decimal | null,
  netWorth: Decimal
}

const client = AaveClient.create()

async function getUserStatus (): Promise<UserStatus> {
  const result = await userMarketState(client, {
    chainId: chainId(environment.CHAIN_ID),
    market: evmAddress(environment.MARKET_ADDRESS),
    user: evmAddress(environment.CHECK_ADDRESS),
  })

  if (result.isErr()) {
    throw result.error
  }

  return {
    healthFactor: result.value.healthFactor ? Decimal(result.value.healthFactor) : null,
    netWorth: Decimal(result.value.netWorth)
  }
}

enum Status {
  GOOD,
  WARNING,
  CRITICAL
}

function getStatusFromHealth (health: Decimal): Status {
  if (health.greaterThanOrEqualTo(environment.WARNING_LEVEL)) {
    return Status.GOOD
  }
  if (health.greaterThanOrEqualTo(environment.CRITICAL_LEVEL)) {
    return Status.WARNING
  }
  return Status.CRITICAL
}

function getStatusString (status: UserStatus): string {
  if (!status.healthFactor) {
    return 'N/A'
  }
  switch (getStatusFromHealth(status.healthFactor)) {
    case Status.CRITICAL: {
      return '⛔️ Critical ⛔️'
    }
    case Status.GOOD: {
      return '✅ Good ✅'
    }
    case Status.WARNING: {
      return '⚠️ Warning ⚠️'
    }
  }
}

async function getStatusMessage (): Promise<string> {
  const status = await getUserStatus()

  return `*${getStatusString(status)}*\n\nHealth factor: *${status.healthFactor?.toFixed(2).replace('.', String.raw`\.`) ?? 'N/A'}*\nNet worth: *${status.netWorth.toFixed(2).replace('.', String.raw`\.`)}$*`
}

async function getDifferenceStatusMessage (status: UserStatus, previousStatus: UserStatus): Promise<string> {
  status ??= await getUserStatus()

  return `*${getStatusString(status)}*\n\nHealth factor: *${previousStatus.healthFactor?.toFixed(2).replace('.', String.raw`\.`) ?? 'N/A'}* ➡️ *${
    status.healthFactor?.toFixed(2).replace('.', String.raw`\.`) ?? 'N/A'}*\nNet worth: *${previousStatus.netWorth.toFixed(2).replace('.', String.raw`\.`)}$* ➡️ *${status.netWorth.toFixed(2).replace('.', String.raw`\.`)}$*`
}

function getErrorMessage (error: unknown, flow: string): string {
  return `📛 Error on \`${flow}\` 📛\n\`\`\`\n${error}\`\`\``
}

interface AlertContext {
  previousStatus: UserStatus
  status: UserStatus,
}

let warningWasSent = false

function getAlertTrigger (context: AlertContext): null | string {
  if (!context.status.healthFactor && context.previousStatus.healthFactor) {
    return 'no health factor now'
  }
  if (!context.status.healthFactor || !context.previousStatus.healthFactor) {
    return null
  }
  const currentStatus = getStatusFromHealth(context.status.healthFactor)
  switch (currentStatus) {
    case Status.CRITICAL: {
      return 'critical health factor'
    }
    case Status.GOOD: {
      warningWasSent = false
      break
    }
    case Status.WARNING: {
      if (warningWasSent) {
        return null
      }
      warningWasSent = true
      return 'warning health factor'
    }
  }

  const difference = context.status.healthFactor.minus(context.previousStatus.healthFactor)
  if (difference.gt(environment.WARNING_DELTA.negated())) {
    return null
  }
  if (difference.gt(environment.CRITITAL_DELTA.negated())) {
    return 'warning delta of health factor'
  }
  return 'critical delta of health factor'
}

let previousStatus: UserStatus = {
  healthFactor: Decimal(0),
  netWorth: Decimal(0)
}

async function getAlertMessage (): Promise<null | string> {
  const status = await getUserStatus()

  const alertTrigger = getAlertTrigger({
    previousStatus,
    status
  })

  const oldPreviousStatus = previousStatus

  previousStatus = status

  if (alertTrigger) {
    return `‼️ ALERT ‼️\nTrigger: \`${alertTrigger.replaceAll('.', String.raw`\.`)}\`\n\n${await getDifferenceStatusMessage(status, oldPreviousStatus)}`
  }

  return null
}

const bot = new Telegraf(environment.TELEGRAM_BOT_TOKEN)

bot.command('status', async (context) => {
  try {
    context.sendMessage(await getStatusMessage(), {
      parse_mode: 'MarkdownV2'
    })
  } catch (error) {
    context.sendMessage(getErrorMessage(error, 'status'), {
      parse_mode: 'MarkdownV2'
    })
  }
})

// eslint-disable-next-line unicorn/prefer-top-level-await
bot.catch(error => {
  logger.error(error)
})

bot.launch(() => logger.info('bot started'))

function startCheckingHealth () {
  async function checkHealth () {
    try {
      const alertMessage = await getAlertMessage()
      if (alertMessage) {
        await bot.telegram.sendMessage(environment.TELEGRAM_BOT_CHAT_ID, alertMessage, {
          parse_mode: 'MarkdownV2'
        })
      }
    } catch (error) {
      await bot.telegram.sendMessage(environment.TELEGRAM_BOT_CHAT_ID, getErrorMessage(error, 'check'), {
        parse_mode: 'MarkdownV2'
      })
    }

    setTimeout(() => checkHealth().catch(error => logger.warn(error)), environment.RECHECK_INTERVAL)
  }

  checkHealth().catch(error => logger.warn(error))
  bot.telegram.sendMessage(environment.TELEGRAM_BOT_CHAT_ID, 'ℹ️ Bot started').catch(error => logger.warn(error))
}

startCheckingHealth()

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
