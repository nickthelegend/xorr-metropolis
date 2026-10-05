import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters } from 'viem'
import { assess, encodeReport, perplMark } from './workflow'

const LIMITS = { maxAnchorGapBps: 150, maxFeedAgeSec: 3600 }
const NOW = 1_791_200_000

// Read on Monad mainnet on 2026-10-05: Perpl's mark, Kuru's book, Chainlink's round.
const calm = { perpl: 0.032357, kuruBid: 0.032339, kuruAsk: 0.032394, chainlink: 0.03234, chainlinkUpdatedAt: NOW - 40 }

describe('assess', () => {
	test('takes the median of three sources and lets trading go on', () => {
		const a = assess(calm, NOW, LIMITS)
		expect(a.answer).toBe(3_235_700n) // the median of 0.032357, 0.0323665 and 0.03234
		expect(a.sources).toBe(3)
		expect(a.spreadBps).toBe(17)
		expect(a.anchorGapBps).toBe(8)
		expect(a.halt).toBe(false)
		expect(a.why).toEqual([])
	})

	test('halts when a market sits too far from Chainlink', () => {
		const a = assess({ ...calm, perpl: 0.0335 }, NOW, LIMITS)
		expect(a.halt).toBe(true)
		expect(a.anchorGapBps).toBe(359)
		expect(a.why).toContain('a market sits 359 bps from Chainlink (limit 150)')
	})

	test('does not use a stale Chainlink round, and halts', () => {
		const a = assess({ ...calm, chainlinkUpdatedAt: NOW - 7200 }, NOW, LIMITS)
		expect(a.sources).toBe(2)
		expect(a.halt).toBe(true)
		expect(a.why).toContain('Chainlink MON/USD round is older than 3600 s')
	})

	test('treats an empty Kuru side as absent, not as a price', () => {
		const a = assess({ ...calm, kuruAsk: null }, NOW, LIMITS)
		expect(a.sources).toBe(2)
		expect(a.spreadBps).toBe(0)
		expect(a.halt).toBe(false)
		expect(a.why).toContain("Kuru's MON/USDC book has no two-sided quote")
	})

	test('halts with fewer than two sources', () => {
		const a = assess({ perpl: null, kuruBid: null, kuruAsk: null, chainlink: 0.03234, chainlinkUpdatedAt: NOW }, NOW, LIMITS)
		expect(a.sources).toBe(1)
		expect(a.halt).toBe(true)
		expect(a.why).toContain('only 1 source answered')
	})
})

describe('the report', () => {
	test('is what XorrPriceReceiver decodes', () => {
		const hex = encodeReport(assess(calm, NOW, LIMITS), BigInt(NOW))
		const [answer, sources, spread, gap, halt, at] = decodeAbiParameters(
			[{ type: 'int256' }, { type: 'uint8' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'bool' }, { type: 'uint64' }],
			hex,
		)
		expect([answer, sources, spread, gap, halt, at]).toEqual([3_235_700n, 3, 17, 8, false, BigInt(NOW)])
	})
})

describe("Perpl's context", () => {
	test('gives the MON mark in its own price decimals', () => {
		const body = JSON.stringify({ markets: [{ id: 1, config: { price_decimals: 1 }, state: { mrk: 844583 } }, { id: 10, config: { price_decimals: 6 }, state: { mrk: 32357 } }] })
		expect(perplMark(body, 10)).toBeCloseTo(0.032357, 9)
		expect(() => perplMark(body, 64)).toThrow("Perpl's context has no mark for market 64")
	})
})
