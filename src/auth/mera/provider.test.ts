import { describe, expect, it } from 'vitest';
import { recoverTransactionAddress, type TransactionSerialized } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { meraProvider } from './provider';
import { signTypedDataAsUser, type ChainAccess } from '@/wallet/userSigning';

// A viem local account: the same interface Mera's `toViemAccount` returns.
const account = privateKeyToAccount(generatePrivateKey());
const provider = meraProvider(account, 143);

describe('a passkey account answering as a wallet', () => {
  it('says it is on the chain the app signs for, and which account it is', async () => {
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x8f');
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address]);
    expect(await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] })).toBeNull();
  });

  it('signs the transaction it is handed, as that account', async () => {
    const raw = (await provider.request({
      method: 'eth_signTransaction',
      params: [
        {
          from: account.address,
          to: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
          data: '0x095ea7b3',
          value: '0x0',
          chainId: 143,
          type: 2,
          nonce: '0x5',
          gasLimit: '0xc350',
          maxFeePerGas: '0x174876e800',
          maxPriorityFeePerGas: '0x77359400',
        },
      ],
    })) as TransactionSerialized;
    expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(account.address);
  });

  it('refuses to sign for another chain', async () => {
    await expect(
      provider.request({ method: 'eth_signTransaction', params: [{ chainId: 1, nonce: '0x0', gasLimit: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }] }),
    ).rejects.toThrow(/signs for 143/);
  });

  it("signs EIP-712 typed data through the app's own signer, which checks the signature is this account's", async () => {
    const signer = { provider, from: account.address, chain: { id: 143, name: 'Monad fork' }, chainAccess: {} as ChainAccess, signOnly: true };
    const signature = await signTypedDataAsUser(signer, {
      domain: { name: 'DelegatedAccountFactory', version: '1', chainId: 143, verifyingContract: '0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209' },
      types: { Create: [{ name: 'owner', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'Create',
      message: { owner: account.address, nonce: 3n, deadline: 1_800_000_000n },
    });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('never sends', async () => {
    await expect(provider.request({ method: 'eth_sendTransaction', params: [{}] })).rejects.toThrow(/Nothing was sent/);
  });
});
