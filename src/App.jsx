import { useStore } from './store'
import ChatWindow from './components/Chat/ChatWindow'
import SettingsPage from './components/SettingsPage'

export default function App() {
  const { currentView } = useStore()

  return (
    <div className="h-full w-full max-w-md mx-auto relative overflow-hidden bg-white shadow-xl">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-pink-100/50" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-pink-50/80" />
      </div>
      <div className="relative h-full flex flex-col">
        {currentView === 'chat' && <ChatWindow />}
        {currentView === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
