/**
 * One agent's own wallet and its own permission (individual agents, 2026-09-23).
 *
 * The wallet the agent signs from, copyable; what the owner let it spend, as the executor read it off the chain; its gas;
 * and "Stop this agent", which signs `revokeAgent` for that wallet alone. Nothing here is a figure the executor did not
 * send: an unreadable permission says so, and a missing gas reading is left out.
 */
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Hex } from 'viem';
import { Button, Press, Row, SheetCard, Text, colors, radius, size, space } from '@/ui';
import type { Agent } from '@/data/types';
import { useNow } from '@/state/useNow';
import { gasLine, permissionLine, permissionState, walletShort } from './agentPermission';
import { agentTxError, personaIdOf, useAgentPermission } from './useAgentPermission';
import { txLink } from './txLink';

const ROW = 52;

export function AgentWalletCard({
  agent,
  onChanged,
  signedTx,
}: {
  agent: Agent;
  onChanged?: () => void;
  /** The permission this visit signed, kept after the hire panel that showed it has gone. */
  signedTx?: string;
}) {
  const now = useNow();
  const { stop, busy } = useAgentPermission();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ txHash: Hex; after?: string }>();
  const state = permissionState(agent, now);
  const gas = gasLine(agent.gasEth);

  async function copy() {
    if (!agent.wallet) return;
    await Clipboard.setStringAsync(agent.wallet);
    setCopied(true);
  }

  async function stopIt() {
    setError(undefined);
    setDone(undefined);
    try {
      const result = await stop(agent, { fire: true });
      setDone(result);
      onChanged?.();
    } catch (e) {
      setError(agentTxError(e));
    }
  }

  const link = done ? txLink(done.txHash) : undefined;

  return (
    <SheetCard borderRadius={radius.panel} padding={space.s16}>
      <Row
        title="Its wallet"
        secondary={copied ? 'Copied' : 'Tap to copy'}
        onPress={agent.wallet ? () => void copy() : undefined}
        value={
          <Text variant="rowPrimary" color={colors.ink55} selectable>
            {walletShort(agent.wallet)}
          </Text>
        }
        height={size.rowLg}
      />
      <Row
        title="Permission"
        secondary={permissionLine(agent, now)}
        height={size.rowLg}
        divider={gas !== null}
      />
      {gas ? <Row title="Gas" value={<Text variant="rowPrimary" color={colors.ink55}>{gas}</Text>} height={ROW} divider={false} /> : null}

      {signedTx && !done ? (
        <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }} selectable>
          {`Permission signed ${txLink(signedTx).label}`}
        </Text>
      ) : null}
      {state === 'live' ? (
        <View style={{ marginTop: space.s12 }}>
          <Button label="Stop this agent" variant="ghost" onPress={stopIt} loading={busy === personaIdOf(agent)} testID="agent-stop" />
        </View>
      ) : null}
      {error ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s8 }}>
          {error}
        </Text>
      ) : null}
      {done ? (
        <Press
          onPress={link?.url ? () => void Linking.openURL(link.url!) : undefined}
          disabled={!link?.url}
          accessibilityRole={link?.url ? 'link' : 'text'}
          style={{ marginTop: space.s8 }}
        >
          <Text variant="footnote" color={colors.ink55} selectable>
            {`Stopped ${link?.label ?? done.txHash}`}
          </Text>
        </Press>
      ) : null}
      {done?.after ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s4 }}>
          {done.after}
        </Text>
      ) : null}
    </SheetCard>
  );
}
