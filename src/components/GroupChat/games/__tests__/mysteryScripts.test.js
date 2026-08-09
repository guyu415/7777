import { describe, expect, it } from 'vitest'
import { MYSTERY_SCRIPTS, validateMysteryScript } from '../scripts'
import { advanceChapter, buildCharacterSystemPrompt, createGame, revealTruth } from '../mysteryEngine'

describe('mystery script catalog', () => {
  it('ships four complete 4-5 player culprit stories', () => {
    expect(MYSTERY_SCRIPTS).toHaveLength(4)
    for (const source of MYSTERY_SCRIPTS) {
      const script = validateMysteryScript(source)
      expect([4, 5]).toContain(script.characters.length)
      expect(script.hasCulprit).toBe(true)
      expect(script.characters.some((character) => character.id === script.truth.culpritId)).toBe(true)
      expect(script.chapters.some((chapter) => chapter.stage === 'vote')).toBe(true)
      expect(script.chapters.some((chapter) => chapter.stage === 'reveal')).toBe(true)
    }
  })

  it('can create and advance a game for every built-in story', () => {
    for (const script of MYSTERY_SCRIPTS) {
      let game = createGame(script.id, {})
      expect(Object.keys(game.seats)).toHaveLength(script.characters.length)
      while (game.chapterIndex < script.chapters.length - 1) game = advanceChapter(game)
      expect(revealTruth(game).log.some((entry) => entry.text.includes(script.truth.summary))).toBe(true)
    }
  })

  it('only injects the selected character secret into its system prompt', () => {
    for (const script of MYSTERY_SCRIPTS) {
      const first = script.characters[0]
      const prompt = buildCharacterSystemPrompt(script.id, first.id)
      expect(prompt).toContain(first.secret)
      for (const other of script.characters.slice(1)) expect(prompt).not.toContain(other.secret)
    }
  })
})
