import { WebSherpaOnnxImpl } from '@eunoia/sherpa-web-impl'
import { AsrService } from '@eunoia/sherpa-asr-service'
import { configureSherpaOnnx, loadWasmModule } from '@eunoia/sherpa-wasm-loader'

const api = new WebSherpaOnnxImpl()

export const ASR = new AsrService(api)
export { configureSherpaOnnx, loadWasmModule }
