/**
 * MON/USD for Monad testnet, from three prices on Monad mainnet — a Chainlink CRE workflow (Chainlink's CRE bounty;
 * SPONSOR-GAP, 2026-10-05).
 *
 * Why it exists: xorr's agents trade MON perps on Perpl's testnet, and every order passes a price gate first. On mainnet
 * that gate reads Chainlink's MON/USD feed; Monad testnet has no MON/USD feed at all. This workflow is the orchestration
 * layer that brings one there, checked against the markets it gates:
 *
 *   cron ─┬─ HTTP, consensus (median across the DON): Perpl's MON mark, from Perpl's public context
 *         ├─ EVM read on monad-mainnet: Kuru's MON/USDC book, best bid and ask
 *         ├─ EVM read on monad-mainnet: Chainlink's MON/USD feed, latest round
 *         └─ assess → report → writeReport on monad-testnet to `XorrPriceReceiver` (contracts/src/XorrPriceReceiver.sol)
 *
 * The report is the median of the prices that answered, Kuru's spread, how far the markets sit from Chainlink, and a halt
 * when that gap is past the limit, Chainlink's round is stale, or fewer than two sources answered — the executor refuses
 * MON orders on testnet while the receiver says halt.
 */
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress } from 'viem'
import { z } from 'zod'

export const configSchema = z.object({
	schedule: z.string(),
	/** Perpl's public API on mainnet; its context lists every market with its mark. */
	perplApi: z.string(),
	perplMarketId: z.number().int(),
	/** Where the prices are read: monad-mainnet. */
	readChain: z.string(),
	kuruBook: z.string(),
	chainlinkMonUsd: z.string(),
	/** Where the report is written: monad-testnet. */
	writeChain: z.string(),
	receiver: z.string(),
	gasLimit: z.string(),
	/** A market further than this from Chainlink halts trading. */
	maxAnchorGapBps: z.number(),
	/** Chainlink's round older than this is not used. */
	maxFeedAgeSec: z.number(),
})

export type Config = z.infer<typeof configSchema>

export type Readings = {
	perpl: number | null
	kuruBid: number | null
	kuruAsk: number | null
	chainlink: number | null
	chainlinkUpdatedAt: number | null
}

export type Assessment = {
	/** The median of the sources that answered, in 8 decimals. */
	answer: bigint
	sources: number
	spreadBps: number
	anchorGapBps: number
	halt: boolean
	why: string[]
}

const U16 = 65_535
const bps = (a: number, b: number) => Math.round((Math.abs(a - b) / b) * 10_000)
const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0

function medianOf(values: number[]): number {
	const s = [...values].sort((a, b) => a - b)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** What the readings say, and whether to halt. Pure: the tests drive it directly. */
export function assess(r: Readings, nowSec: number, limits: Pick<Config, 'maxAnchorGapBps' | 'maxFeedAgeSec'>): Assessment {
	const why: string[] = []
	const kuruMid = valid(r.kuruBid) && valid(r.kuruAsk) && r.kuruAsk >= r.kuruBid ? (r.kuruBid + r.kuruAsk) / 2 : null
	const spreadBps = kuruMid !== null ? Math.min(U16, Math.round(((r.kuruAsk! - r.kuruBid!) / kuruMid) * 10_000)) : 0
	const chainlinkFresh =
		valid(r.chainlink) && r.chainlinkUpdatedAt !== null && nowSec - r.chainlinkUpdatedAt <= limits.maxFeedAgeSec
	if (!valid(r.chainlink)) why.push('Chainlink MON/USD did not answer')
	else if (!chainlinkFresh) why.push(`Chainlink MON/USD round is older than ${limits.maxFeedAgeSec} s`)
	if (!valid(r.perpl)) why.push('Perpl gave no MON mark')
	if (kuruMid === null) why.push("Kuru's MON/USDC book has no two-sided quote")

	const prices = [r.perpl, kuruMid, chainlinkFresh ? r.chainlink : null].filter(valid)
	const answer = prices.length > 0 ? BigInt(Math.round(medianOf(prices) * 1e8)) : 0n
	const markets = [r.perpl, kuruMid].filter(valid)
	const anchorGapBps = chainlinkFresh && markets.length > 0 ? Math.min(U16, Math.max(...markets.map((p) => bps(p, r.chainlink!)))) : 0

	let halt = false
	if (prices.length < 2) {
		halt = true
		why.push(`only ${prices.length} source${prices.length === 1 ? '' : 's'} answered`)
	}
	if (!chainlinkFresh) halt = true
	if (anchorGapBps > limits.maxAnchorGapBps) {
		halt = true
		why.push(`a market sits ${anchorGapBps} bps from Chainlink (limit ${limits.maxAnchorGapBps})`)
	}
	return { answer, sources: prices.length, spreadBps, anchorGapBps, halt, why }
}

/** The report `XorrPriceReceiver._processReport` decodes. */
export function encodeReport(a: Assessment, observedAt: bigint): `0x${string}` {
	return encodeAbiParameters(
		[
			{ type: 'int256' },
			{ type: 'uint8' },
			{ type: 'uint16' },
			{ type: 'uint16' },
			{ type: 'bool' },
			{ type: 'uint64' },
		],
		[a.answer, a.sources, a.spreadBps, a.anchorGapBps, a.halt, observedAt],
	)
}

type PerplContext = { markets?: { id: number; config?: { price_decimals?: number }; state?: { mrk?: number } }[] }

/** Perpl's MON mark, read by each node; the DON agrees on the median. */
export function perplMark(body: string, marketId: number): number {
	const ctx = JSON.parse(body) as PerplContext
	const m = (ctx.markets ?? []).find((x) => x.id === marketId)
	if (!m || typeof m.state?.mrk !== 'number') throw new Error(`Perpl's context has no mark for market ${marketId}`)
	return m.state.mrk / 10 ** (m.config?.price_decimals ?? 0)
}

const fetchPerpl = (send: HTTPSendRequester, config: Config): { perplMark: number } => {
	const res = send.sendRequest({ method: 'GET', url: `${config.perplApi}/v1/pub/context` }).result()
	if (res.statusCode !== 200) throw new Error(`Perpl answered HTTP ${res.statusCode}`)
	return { perplMark: perplMark(Buffer.from(res.body).toString('utf-8'), config.perplMarketId) }
}

const KURU_ABI = parseAbi(['function bestBidAsk() view returns (uint256, uint256)'])
const FEED_ABI = parseAbi([
	'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
	'function decimals() view returns (uint8)',
])

function evmFor(chainSelectorName: string, isTestnet: boolean) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName, isTestnet })
	if (!network) throw new Error(`CRE does not know the network ${chainSelectorName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

/** One `eth_call` at the last finalized block, through the DON's EVM capability. */
function call(runtime: Runtime<Config>, evm: InstanceType<typeof cre.capabilities.EVMClient>, to: string, data: `0x${string}`): `0x${string}` {
	const res = evm
		.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
		.result()
	return bytesToHex(res.data)
}

/** Kuru quotes 2^256−1 / 0 for a side with no resting order: that side is absent, not a price. */
const kuruSide = (raw: bigint) => (raw === 0n || raw >= 2n ** 255n ? null : Number(raw) / 1e18)

export const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
	const config = runtime.config
	const observedAt = payload.scheduledExecutionTime?.seconds
	if (observedAt === undefined) throw new Error('The cron trigger gave no scheduled time')

	// 1. Perpl's mark over HTTP, the median across the DON's nodes.
	let perpl: number | null = null
	try {
		perpl = new cre.capabilities.HTTPClient()
			.sendRequest(runtime, fetchPerpl, ConsensusAggregationByFields<{ perplMark: number }>({ perplMark: median }))(config)
			.result().perplMark
	} catch (e) {
		runtime.log(`Perpl: ${e instanceof Error ? e.message : String(e)}`)
	}

	// 2–3. Kuru's book and Chainlink's feed, read on Monad mainnet.
	const mainnet = evmFor(config.readChain, false)
	let kuruBid: number | null = null
	let kuruAsk: number | null = null
	try {
		const [bid, ask] = decodeFunctionResult({
			abi: KURU_ABI,
			functionName: 'bestBidAsk',
			data: call(runtime, mainnet, config.kuruBook, encodeFunctionData({ abi: KURU_ABI, functionName: 'bestBidAsk' })),
		})
		kuruBid = kuruSide(bid)
		kuruAsk = kuruSide(ask)
	} catch (e) {
		runtime.log(`Kuru: ${e instanceof Error ? e.message : String(e)}`)
	}
	let chainlink: number | null = null
	let chainlinkUpdatedAt: number | null = null
	try {
		const round = decodeFunctionResult({
			abi: FEED_ABI,
			functionName: 'latestRoundData',
			data: call(runtime, mainnet, config.chainlinkMonUsd, encodeFunctionData({ abi: FEED_ABI, functionName: 'latestRoundData' })),
		})
		const decimals = decodeFunctionResult({
			abi: FEED_ABI,
			functionName: 'decimals',
			data: call(runtime, mainnet, config.chainlinkMonUsd, encodeFunctionData({ abi: FEED_ABI, functionName: 'decimals' })),
		})
		chainlink = Number(round[1]) / 10 ** decimals
		chainlinkUpdatedAt = Number(round[3])
	} catch (e) {
		runtime.log(`Chainlink: ${e instanceof Error ? e.message : String(e)}`)
	}

	const a = assess({ perpl, kuruBid, kuruAsk, chainlink, chainlinkUpdatedAt }, Number(observedAt), config)
	runtime.log(
		`MON/USD ${Number(a.answer) / 1e8} from ${a.sources} sources (Perpl ${perpl}, Kuru ${kuruBid}/${kuruAsk}, Chainlink ${chainlink}); ` +
			`spread ${a.spreadBps} bps, gap to Chainlink ${a.anchorGapBps} bps; halt ${a.halt}${a.why.length ? ` — ${a.why.join('; ')}` : ''}`,
	)

	// 4. The report, signed by the DON and written through the forwarder to the receiver on Monad testnet.
	const report = runtime.report(prepareReportRequest(encodeReport(a, observedAt))).result()
	const write = evmFor(config.writeChain, true)
		.writeReport(runtime, { receiver: config.receiver as Address, report, gasConfig: { gasLimit: config.gasLimit } })
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	const tx = bytesToHex(write.txHash ?? new Uint8Array(32))
	runtime.log(`Written to ${config.receiver} on ${config.writeChain}: ${tx}`)
	return `${Number(a.answer) / 1e8} halt=${a.halt} tx=${tx}`
}

export function initWorkflow(config: Config) {
	return [cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron)]
}
