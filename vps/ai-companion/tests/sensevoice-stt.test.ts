import { describe, expect, test } from 'bun:test'
import { parseSenseVoiceOutput } from '../sensevoice-stt'

describe('SenseVoice output parser', () => {
  test('extracts real acoustic metadata and transcript', () => {
    expect(parseSenseVoiceOutput('<|zh|><|ANGRY|><|Speech|><|withitn|>你到底在干什么？')).toEqual({
      text: '你到底在干什么？',
      emotion: 'angry',
      event: 'SPEECH',
      language: 'zh',
    })
  })

  test('does not invent an emotion when the runtime omits the tag', () => {
    expect(parseSenseVoiceOutput('<|zh|><|Speech|>你好').emotion).toBe('unknown')
  })
})
