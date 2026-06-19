import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { fetchModels } from '../services/claude'

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,182,209,0.35)',
  borderRadius: 14,
  padding: '10px 16px',
  fontSize: 14,
  color: '#8b5060',
  outline: 'none',
  fontFamily: 'inherit',
}

export default function ProviderSettings() {
  const { providers, selectedProviderId, selectedModelId, setSelectedProviderId, setSelectedModelId, updateProvider } = useStore()
  const [expandedId, setExpandedId] = useState(null)
  const [showKeys, setShowKeys] = useState({})
  const [fetchingId, setFetchingId] = useState(null)
  const [fetchError, setFetchError] = useState({})

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)
  const toggleShowKey = (id) => setShowKeys(prev => ({ ...prev, [id]: !prev[id] }))

  const handleFetchModels = async (provider) => {
    setFetchingId(provider.id)
    setFetchError(prev => ({ ...prev, [provider.id]: null }))
    try {
      const models = await fetchModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey })
      updateProvider(provider.id, { models })
    } catch (err) {
      setFetchError(prev => ({ ...prev, [provider.id]: err.message }))
    } finally {
      setFetchingId(null)
    }
  }

  const handleSelectProvider = (id) => {
    setSelectedProviderId(id)
    const p = providers.find(p => p.id === id)
    if (p?.models?.length) setSelectedModelId(p.models[0])
  }

  return (
    <div className="space-y-3">
      {(providers || []).map(provider => {
        const isActive = provider.id === selectedProviderId
        const isExpanded = expandedId === provider.id
        return (
          <div
            key={provider.id}
            style={{
              borderRadius: 16,
              border: isActive ? '1.5px solid rgba(255,133,179,0.5)' : '1px solid rgba(255,182,209,0.25)',
              background: isActive ? 'rgba(255,133,179,0.06)' : 'rgba(255,255,255,0.4)',
              overflow: 'hidden',
            }}
          >
            <div
              className="flex items-center justify-between px-3 py-2.5 cursor-pointer"
              onClick={() => { handleSelectProvider(provider.id); toggleExpand(provider.id) }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: isActive ? 'linear-gradient(135deg, #ff85b3, #ff6b9d)' : 'rgba(210,180,195,0.5)' }}
                />
                <span className="text-sm font-medium" style={{ color: '#8b5060' }}>{provider.name}</span>
                {isActive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)' }}>
                    使用中
                  </span>
                )}
              </div>
              {isExpanded ? <ChevronUp size={14} style={{ color: '#c47a8a' }} /> : <ChevronDown size={14} style={{ color: '#c47a8a' }} />}
            </div>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2" onClick={e => e.stopPropagation()}>
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>名称</label>
                  <input
                    value={provider.name}
                    onChange={e => updateProvider(provider.id, { name: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>Base URL</label>
                  <input
                    type="url"
                    value={provider.baseUrl}
                    onChange={e => updateProvider(provider.id, { baseUrl: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>API Key</label>
                  <div className="relative">
                    <input
                      type={showKeys[provider.id] ? 'text' : 'password'}
                      value={provider.apiKey}
                      onChange={e => updateProvider(provider.id, { apiKey: e.target.value })}
                      style={{ ...inputStyle, paddingRight: 40 }}
                    />
                    <button
                      onClick={() => toggleShowKey(provider.id)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: '#d4a0b0' }}
                    >
                      {showKeys[provider.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-xs pl-1" style={{ color: '#c47a8a' }}>模型列表</label>
                  <button
                    onClick={() => handleFetchModels(provider)}
                    disabled={fetchingId === provider.id}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-white transition-all"
                    style={{
                      background: fetchingId === provider.id ? 'rgba(255,182,209,0.4)' : 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
                      boxShadow: fetchingId === provider.id ? 'none' : '0 2px 8px rgba(255,133,179,0.35)',
                    }}
                  >
                    <RefreshCw size={11} className={fetchingId === provider.id ? 'animate-spin' : ''} />
                    获取模型
                  </button>
                </div>

                {fetchError[provider.id] && (
                  <p className="text-xs pl-1" style={{ color: '#e07070' }}>{fetchError[provider.id]}</p>
                )}

                {(provider.models || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {provider.models.map(m => {
                      const isSelected = isActive && selectedModelId === m
                      return (
                        <button
                          key={m}
                          onClick={() => { setSelectedProviderId(provider.id); setSelectedModelId(m) }}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                          style={isSelected ? {
                            background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
                            color: '#fff',
                            boxShadow: '0 2px 8px rgba(255,133,179,0.4)',
                            border: 'none',
                          } : {
                            background: 'rgba(255,255,255,0.5)',
                            color: '#c47a8a',
                            border: '1px solid rgba(255,182,209,0.3)',
                          }}
                        >
                          {m}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
