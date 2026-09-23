/**
 * Hire an agent, or give a hired one its permission (individual agents, 2026-09-23).
 *
 * Two choices and one signature: the most this agent may spend a day, and for how long. The defaults are the
 * executor's suggestion (`/agents/:id/permission`), landed on the steppers. The owner's wallet signs `grantAgent` on
 * the chain first; the agent is hired only once that shows (`useAgentPermission`). The hash is shown when it lands, and
 * a failure is one line under the button — never swallowed.
 */
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Hex } from 'viem';
import { Button, NoteStrip, Pill, SheetCard, Stepper, Text, colors, money, radius, size, space } from '@/ui';
import { useAsync } from '@/data/useAsync';
import type { Agent } from '@/data/types';
import {
  AGENT_CAPS,
  AGENT_DAYS,
  nearestStep,
  stepFrom,
  walletShort,
  type PermissionOffer,
} from './agentPermission';
import {
  NeedsOwnGrant,
  agentTxError,
  fetchPermissionOffer,
  personaIdOf,
  readStopped,
  useAgentPermission,
} from './useAgentPermission';
import { txLink } from './txLink';

type Cap = (typeof AGENT_CAPS)[number];
type Days = (typeof AGENT_DAYS)[number];

export function AgentHirePanel({
  agent,
  onDone,
}: {
  agent: Agent;
  /** After the permission is on the chain (and the hire saved, or said why not). */
  onDone?: (txHash: Hex) => void;
}) {
  const pid = personaIdOf(agent);
  const { hire, busy, owner } = useAgentPermission();
  const offer = useAsync<PermissionOffer>(() => fetchPermissionOffer(agent), [pid]);
  // The owner's stop-all: a new agent permission lifts it (XorrDelegation `_grantAgent`), so that is said first.
  const contract = offer.data?.contract;
  const stopped = useAsync(
    () => (contract && owner ? readStopped(contract, owner) : Promise.resolve(undefined)),
    [contract, owner],
  );

  const [cap, setCap] = useState<Cap>();
  const [days, setDays] = useState<Days>();
  const capShown: Cap = cap ?? nearestStep(AGENT_CAPS, offer.data?.suggestedDailyCapUsd, 100);
  const daysShown: Days = days ?? nearestStep(AGENT_DAYS, offer.data?.suggestedDays, 7);

  const router = useRouter();
  const [error, setError] = useState<{ text: string; needsGrant: boolean }>();
  const [done, setDone] = useState<{ txHash: Hex; after?: string }>();

  async function sign() {
    setError(undefined);
    setDone(undefined);
    try {
      const result = await hire(agent, capShown, daysShown);
      setDone(result);
      onDone?.(result.txHash);
    } catch (e) {
      setError({ text: agentTxError(e), needsGrant: e instanceof NeedsOwnGrant });
    }
  }

  const link = done ? txLink(done.txHash) : undefined;
  const inFlight = busy === pid;

  return (
    <SheetCard borderRadius={radius.panel} padding={space.s16}>
      <Text variant="cardTitle">{agent.hired ? 'Needs your permission' : `Hire ${agent.name}`}</Text>
      <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s4 }}>
        {offer.data ? `Its own wallet ${walletShort(offer.data.delegate)}. You sign.` : 'Its own wallet. You sign.'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s16, gap: space.s12 }}>
        <Text variant="rowPrimary">A day, at most</Text>
        <Stepper
          value={money(capShown, { decimals: 0 })}
          onDecrement={() => setCap(stepFrom(AGENT_CAPS, capShown, -1))}
          onIncrement={() => setCap(stepFrom(AGENT_CAPS, capShown, 1))}
          canDecrement={capShown > AGENT_CAPS[0]}
          canIncrement={capShown < AGENT_CAPS[AGENT_CAPS.length - 1]!}
          valueMinWidth={size.stepperValueMinW}
          testID="agent-cap"
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s14, gap: space.s12 }}>
        <Text variant="rowPrimary">For</Text>
        <Pill
          label={daysShown === 1 ? '1 day' : `${daysShown} days`}
          selected
          onPress={() => {
            const i = AGENT_DAYS.indexOf(daysShown);
            setDays(AGENT_DAYS[(i + 1) % AGENT_DAYS.length]!);
          }}
        />
      </View>

      {stopped.data ? (
        <NoteStrip kind="risk" style={{ marginTop: space.s14 }}>
          You stopped all trading. Signing this resumes it.
        </NoteStrip>
      ) : null}

      <Button
        label={agent.hired ? 'Sign permission' : 'Sign and hire'}
        onPress={sign}
        loading={inFlight}
        disabled={!offer.data}
        style={{ marginTop: space.s16 }}
        testID="agent-hire"
      />

      {offer.error ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s8 }}>
          {agentTxError(offer.error)}
        </Text>
      ) : null}
      {error ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s8 }}>
          {error.text}
        </Text>
      ) : null}
      {error?.needsGrant ? (
        <Button label="Set limits" variant="ghost" onPress={() => router.push('/delegate')} style={{ marginTop: space.s10 }} />
      ) : null}
      {done ? (
        <Text
          variant="footnote"
          color={link?.url ? colors.ink : colors.ink55}
          style={{ marginTop: space.s8 }}
          selectable
          onPress={link?.url ? () => void Linking.openURL(link.url!) : undefined}
        >
          {`Signed ${link?.label ?? done.txHash}`}
        </Text>
      ) : null}
      {done?.after ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s4 }}>
          {done.after}
        </Text>
      ) : null}
    </SheetCard>
  );
}
