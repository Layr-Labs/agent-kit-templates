import { mnemonicToAccount, type HDAccount } from 'viem/accounts'
import { createPublicClient, http, formatEther } from 'viem'
import { mainnet, base } from 'viem/chains'
import { Keypair } from '@solana/web3.js'
import { mnemonicToSeedSync } from 'bip39'
import { derivePath } from 'ed25519-hd-key'

export class WalletManager {
  private ethAccount: HDAccount
  private solKeypair: Keypair
  readonly ethAddress: string
  readonly solAddress: string

  constructor(mnemonic: string) {
    this.ethAccount = mnemonicToAccount(mnemonic)
    this.ethAddress = this.ethAccount.address

    const seed = mnemonicToSeedSync(mnemonic)
    const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
    this.solKeypair = Keypair.fromSeed(key)
    this.solAddress = this.solKeypair.publicKey.toBase58()
  }

  async getEthBalance(chain: 'mainnet' | 'base' = 'mainnet', rpcUrl?: string): Promise<string> {
    const client = createPublicClient({
      chain: chain === 'base' ? base : mainnet,
      transport: http(rpcUrl),
    })
    const balance = await client.getBalance({ address: this.ethAccount.address })
    return formatEther(balance)
  }

  getEthAccount(): HDAccount {
    return this.ethAccount
  }

  getSolKeypair(): Keypair {
    return this.solKeypair
  }
}
