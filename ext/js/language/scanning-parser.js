/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import {distributeFuriganaInflected, isCodePointJapanese} from './ja/japanese.js';

/** @typedef {{originalTextLength: number, textSegments: import('api').ParseTextSegment[]}} ScanningResult */

/**
 * Scanning parser shared by the extension backend and embedded hosts.
 * @param {Pick<import('./translator.js').Translator, 'findTerms'>} translator
 * @param {string} text
 * @param {number} scanLength
 * @param {import('translation').FindTermsOptions} findTermsOptions
 * @param {{get: (key: string) => ScanningResult | undefined, set: (key: string, value: ScanningResult) => unknown}} cache
 * @param {string | number | undefined} cacheContext
 * @param {boolean} useAllFrequencyDictionaries
 * @returns {Promise<import('api').ParseTextLine[]>}
 */
export async function parseTextScanning(translator, text, scanLength, findTermsOptions, cache = new Map(), cacheContext, useAllFrequencyDictionaries = true) {
    const mode = 'simple';
    /** @type {import('api').ParseTextLine[]} */
    const results = [];
    let previousUngroupedSegment = null;
    let i = 0;
    const ii = text.length;
    while (i < ii) {
        const codePoint = /** @type {number} */ (text.codePointAt(i));
        const character = String.fromCodePoint(codePoint);
        const substring = text.substring(i, i + scanLength);
        const metadataMode = useAllFrequencyDictionaries === true ? 1 : 0;
        const cacheKey = `${cacheContext}:${metadataMode}:${substring}`;
        let cached = cache.get(cacheKey);
        if (typeof cached === 'undefined') {
            const {dictionaryEntries, originalTextLength} = await translator.findTerms(
                mode,
                substring,
                findTermsOptions,
            );
            /** @type {import('api').ParseTextSegment[]} */
            const textSegments = [];
            if (dictionaryEntries.length > 0 &&
            originalTextLength > 0 &&
            (originalTextLength !== character.length || isCodePointJapanese(codePoint))
            ) {
                const {headwords: [{term, reading}]} = dictionaryEntries[0];
                const source = substring.substring(0, originalTextLength);
                for (const {text: text2, reading: reading2} of distributeFuriganaInflected(term, reading, source)) {
                    textSegments.push({text: text2, reading: reading2});
                }
                if (textSegments.length > 0) {
                    const token = textSegments.map((s) => s.text).join('');
                    const trimmedHeadwords = [];
                    for (const dictionaryEntry of dictionaryEntries) {
                        const validHeadwords = [];
                        for (const headword of dictionaryEntry.headwords) {
                            const validSources = [];
                            for (const src of headword.sources) {
                                if (src.originalText !== token) { continue; }
                                if (!src.isPrimary) { continue; }
                                if (src.matchType !== 'exact') { continue; }
                                validSources.push(src);
                            }
                            if (validSources.length > 0) {
                                validHeadwords.push({
                                    term: headword.term,
                                    reading: headword.reading,
                                    sources: validSources,
                                    frequencies: dictionaryEntry.frequencies.filter((f) => f.headwordIndex === headword.headwordIndex),
                                    pronunciations: dictionaryEntry.pronunciations.filter((p) => p.headwordIndex === headword.headwordIndex),
                                });
                            }
                        }
                        if (validHeadwords.length > 0) { trimmedHeadwords.push(validHeadwords); }
                    }
                    textSegments[0].headwords = trimmedHeadwords;
                }
            }
            cached = {originalTextLength, textSegments};
            if (typeof cacheContext !== 'undefined') { cache.set(cacheKey, cached); }
        }
        const {originalTextLength, textSegments} = cached;
        if (textSegments.length > 0) {
            previousUngroupedSegment = null;
            results.push(textSegments);
            i += originalTextLength;
        } else {
            if (previousUngroupedSegment === null) {
                previousUngroupedSegment = {text: character, reading: ''};
                results.push([previousUngroupedSegment]);
            } else {
                previousUngroupedSegment.text += character;
            }
            i += character.length;
        }
    }
    return results;
}
