import { useStore } from './store'
import ChatWindow from './components/Chat/ChatWindow'
import SettingsPage from './components/SettingsPage'

const PETALS = ['🌸', '🌺', '✿', '🌸', '✾']

export default function App() {
  const { currentView } = useStore()

  return (
    <div className="h-full w-full" style={{
      background: 'linear-gradient(160deg, #fce4ec 0%, #f8bbd0 25%, #fce4ec 55%, #fff0f6 80%, #ffeef5 100%)'
    }}>
      {/* Blurred orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div style={{ position:'absolute', top:'-80px', right:'-60px', width:'280px', height:'280px', borderRadius:'50%', background:'rgba(255,182,193,0.45)', filter:'blur(60px)' }} />
        <div style={{ position:'absolute', bottom:'-100px', left:'-80px', width:'340px', height:'340px', borderRadius:'50%', background:'rgba(255,192,203,0.4)', filter:'blur(80px)' }} />
        <div style={{ position:'absolute', top:'40%', left:'30%', width:'200px', height:'200px', borderRadius:'50%', background:'rgba(255,228,236,0.5)', filter:'blur(50px)' }} />
        {/* Floating petals */}
        {PETALS.map((p, i) => (
          <span key={i} className="petal">{p}</span>
        ))}
      </div>

      {/* App shell */}
      <div className="relative h-full w-full max-w-md mx-auto flex flex-col overflow-hidden" style={{
        boxShadow: '0 0 60px rgba(255,133,179,0.15)'
      }}>
        {currentView === 'chat' && <ChatWindow />}
        {currentView === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
