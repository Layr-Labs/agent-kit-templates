import type { Skill, SkillContext } from '../../types.js'
import { mnemonicToSeedSync } from 'bip39'

const skill: Skill = {
  name: 'email',
  description: 'Email for agents via EigenMail SDK. Derives private key from the agent mnemonic automatically.',
  category: 'agent',

  async init(ctx: SkillContext) {
    // Derive the private key from the mnemonic — same key as the wallet
    let privateKey = process.env.EIGENMAIL_PRIVATE_KEY

    if (!privateKey) {
      const mnemonic = process.env.MNEMONIC
      if (!mnemonic) {
        console.log('Email skill: No MNEMONIC or EIGENMAIL_PRIVATE_KEY set, skipping.')
        return {}
      }

      try {
        const { HDKey } = await import('viem/accounts')
        const seed = mnemonicToSeedSync(mnemonic)
        const hd = HDKey.fromMasterSeed(seed)
        const derived = hd.derive("m/44'/60'/0'/0/0")
        privateKey = `0x${Buffer.from(derived.privateKey!).toString('hex')}`
      } catch (err) {
        console.error('Email skill: Failed to derive key from mnemonic:', (err as Error).message)
        return {}
      }
    }

    try {
      const { EigenMailClient, eigenMailTools } = await import('eigenmail-sdk')

      const client = new EigenMailClient({
        privateKey: privateKey as `0x${string}`,
        apiUrl: process.env.EIGENMAIL_API_URL ?? 'https://api.eigenagents.org',
      })

      const loginResult = await client.login()
      const me = await client.me()
      console.log(`Email skill: ${me.email} (${me.address})`)

      // Store email on context so other skills can use it
      ;(ctx as any).agentEmail = me.email

      return eigenMailTools(client)
    } catch (err) {
      console.error('Email skill failed to init:', (err as Error).message)
      return {}
    }
  },
}

export default skill
