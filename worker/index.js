import { handleMemeRequest } from './memes.js'
import baseWorker from './scheduled-message-worker.js'
import { handleFortuneRequest } from './fortune.js'

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const memeResponse = await handleMemeRequest(request, env)
    if (memeResponse) return memeResponse
    const fortuneResponse = await handleFortuneRequest(request, env)
    if (fortuneResponse) return fortuneResponse
    return baseWorker.fetch(request, env, ctx)
  },
}
