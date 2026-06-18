import { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Save, Trash2, Brain } from 'lucide-react'
import { useStore } from '../store'
import { MODEL_LABELS } from '../services/claude'
import clsx from 'clsx'

const MODELS = Object.keys(MODEL_LABELS)

export default function SettingsPage() {
  const {
    apiKey, setApiKey,
    apiBaseUrl, setApiBaseUrl,
    model, setModel,
    systemPrompt, setSystemPrompt,
    memoryEnabled, setMemoryEnabled,
    memoryEndpoint, setMemoryEndpoint,
    setCurrentView,
  } = useStore()

  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex flex-col h-full bg-pink-50/30">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-pink-100 safe-top shadow-sm">
        <button onClick={() => setCurrentView('chat')} className="w-9 h-9 rounded-full bg-pink-50 flex items-center justify-center text-pink-400">
          <ArrowLeft size={18} />
        </button>
        <div className="font-semibold text-gray-800">设置</div>
        <div className="ml-auto text-xl">⚙️</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* API Key */}
        <Section icon="🔑" title="API Key">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-white border border-pink-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-700 focus:outline-none focus:border-pink-400"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-300"
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 pl-1">Key 存储在浏览器本地，不会上传</p>
          <div className="mt-3">
            <label className="text-xs text-gray-500 pl-1 mb-1 block">API Base URL</label>
            <input
              type="url"
              value={apiBaseUrl}
              onChange={e => setApiBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
              className="w-full bg-white border border-pink-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-pink-400"
            />
            <p className="text-xs text-gray-400 mt-1.5 pl-1">可填中转代理地址，留空则使用官方</p>
          </div>
        </Section>

        {/* Model */}
        <Section icon="🤖" title="模型选择">
          <div className="grid grid-cols-3 gap-2">
            {MODELS.map(m => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={clsx(
                  'py-2 px-2 rounded-xl text-xs font-medium border transition-all',
                  model === m
                    ? 'bg-pink-400 text-white border-pink-400 shadow-md'
                    : 'bg-white text-gray-500 border-pink-100'
                )}
              >
                {MODEL_LABELS[m]}
              </button>
            ))}
          </div>
        </Section>

        {/* System Prompt */}
        <Section icon="💬" title="系统提示词">
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={4}
            className="w-full bg-white border border-pink-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-pink-400 resize-none leading-relaxed"
            placeholder="描述 AI 的性格和行为..."
          />
        </Section>

        {/* Memory */}
        <Section icon="🧠" title="记忆系统">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">接入 MCP 记忆库</span>
            <button
              onClick={() => setMemoryEnabled(!memoryEnabled)}
              className={clsx(
                'w-12 h-6 rounded-full transition-colors relative',
                memoryEnabled ? 'bg-pink-400' : 'bg-gray-200'
              )}
            >
              <div className={clsx(
                'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform shadow',
                memoryEnabled ? 'translate-x-6' : 'translate-x-0.5'
              )} />
            </button>
          </div>
          {memoryEnabled && (
            <input
              type="url"
              value={memoryEndpoint}
              onChange={e => setMemoryEndpoint(e.target.value)}
              placeholder="https://memory.xiaoman.xyz"
              className="w-full bg-white border border-pink-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-pink-400"
            />
          )}
        </Section>

        {/* Danger zone */}
        <Section icon="⚠️" title="危险操作">
          <button
            onClick={() => {
              if (confirm('确定要清空所有聊天记录吗？')) {
                indexedDB.deleteDatabase('pink-chat')
                window.location.reload()
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-400 rounded-xl text-sm border border-red-100"
          >
            <Trash2 size={14} />
            清空聊天记录
          </button>
        </Section>
      </div>

      {/* Save button */}
      <div className="px-4 pb-6 pt-2 safe-bottom">
        <button
          onClick={handleSave}
          className={clsx(
            'w-full py-3 rounded-2xl font-semibold text-sm transition-all shadow-md',
            saved ? 'bg-green-400 text-white' : 'bg-pink-400 text-white'
          )}
        >
          {saved ? '✅ 已保存' : '保存设置'}
        </button>
      </div>
    </div>
  )
}

function Section({ icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span>{icon}</span>
        <span className="font-medium text-gray-700 text-sm">{title}</span>
      </div>
      {children}
    </div>
  )
}
