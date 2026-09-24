/**
 * A Mera passkey account, spoken to the way the app speaks to any wallet (`wallet/userSigning.ts`).
 *
 * The app's signer asks a wallet for exactly these: which chain it is on, to sign a transaction (it then broadcasts it
 * itself), to sign EIP-712 typed data, and to sign a message. A Mera account signs all of them locally, from a session that
 * holds the key only until it ends — no wallet sheet, no prompt. Anything that would SEND is refused: this build signs
 * and the app broadcasts to the chain it reads (`signOnly`), so a request to send means something asked the wrong thing.
 */
import { toHex, type Hex, type LocalAccount, type TypedDataDefinition } from 'viem';
import type { WalletProvider } from '@/wallet/userSigning';

const big = (v: unknown): bigint => BigInt(v as string);

/**
 * EIP-712 messages arrive as JSON, with every bigint written as a string (`signTypedDataAsUser`). viem hashes by the
 * declared types, so each integer field goes back to a bigint before signing — walked through nested structs and arrays.
 */
function reviveTyped(typed: TypedDataDefinition & { types: Record<string, { name: string; type: string }[]> }): TypedDataDefinition {
  const revive = (typeName: string, value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (typeName.endsWith(']')) {
      const inner = typeName.slice(0, typeName.lastIndexOf('['));
      return (value as unknown[]).map((v) => revive(inner, v));
    }
    if (/^u?int\d*$/.test(typeName)) return big(value);
    const fields = typed.types[typeName];
    if (!fields) return value;
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f.name] = revive(f.type, (value as Record<string, unknown>)[f.name]);
    return out;
  };
  const domain = typed.domain ? { ...typed.domain } : undefined;
  if (domain && 'chainId' in domain && domain.chainId !== undefined) (domain as { chainId?: unknown }).chainId = Number(domain.chainId);
  return { ...typed, domain, message: revive(typed.primaryType as string, typed.message) as Record<string, unknown> } as TypedDataDefinition;
}

export function meraProvider(account: LocalAccount, chainId: number): WalletProvider {
  return {
    async request({ method, params = [] }) {
      switch (method) {
        case 'wallet_switchEthereumChain':
          // One account, on whatever chain the transaction names: nothing to switch.
          return null;
        case 'eth_chainId':
          return toHex(chainId);
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [account.address];
        case 'eth_signTransaction': {
          const tx = params[0] as Record<string, string>;
          if (Number(tx.chainId) !== chainId) throw new Error(`Asked to sign for chain ${tx.chainId}; this account signs for ${chainId}.`);
          return account.signTransaction!({
            type: 'eip1559',
            chainId,
            to: tx.to as Hex,
            data: tx.data as Hex,
            value: big(tx.value ?? '0x0'),
            nonce: Number(tx.nonce),
            gas: big(tx.gasLimit ?? tx.gas),
            maxFeePerGas: big(tx.maxFeePerGas),
            maxPriorityFeePerGas: big(tx.maxPriorityFeePerGas),
          });
        }
        case 'eth_signTypedData_v4': {
          const typed = JSON.parse(params[1] as string);
          return account.signTypedData!(reviveTyped(typed));
        }
        case 'personal_sign':
          return account.signMessage!({ message: { raw: params[0] as Hex } });
        case 'eth_sendTransaction':
          throw new Error('A passkey account signs; the app sends. Nothing was sent.');
        default:
          throw new Error(`A passkey account does not answer ${method}.`);
      }
    },
  };
}
