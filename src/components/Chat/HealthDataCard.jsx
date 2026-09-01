import { Activity } from 'lucide-react'
import { healthDataCategories } from '../../utils/healthData'

export default function HealthDataCard({ toolUses = [], content = '', categories: suppliedCategories, streaming = false }) {
  const categories = suppliedCategories ?? healthDataCategories(toolUses, content)

  return (
    <div
      className="health-data-card mt-1.5 mb-1"
      role="status"
      aria-live="polite"
      aria-label={streaming ? '正在读取健康数据' : `已读取健康数据：${categories.map((item) => item.label).join('、')}`}
    >
      <div className="health-data-card__visual" aria-hidden="true">
        <Activity size={27} strokeWidth={1.8} />
      </div>
      <div className="health-data-card__copy">
        <div className="health-data-card__eyebrow">
          <span className={`health-data-card__dot${streaming ? ' is-reading' : ''}`} />
          Apple Health
        </div>
        <div className="health-data-card__title">{streaming ? '正在读取健康数据…' : '已读取健康数据'}</div>
        <div className="health-data-card__metrics">
          {categories.map((item) => <span className="health-data-card__metric" key={item.id}>{item.label}</span>)}
        </div>
      </div>
    </div>
  )
}
