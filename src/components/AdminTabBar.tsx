import { ADMIN_TABS, type AdminTabId } from '../config/adminTabs'

export const adminTabId = (tab: AdminTabId): string => `admin-tab-${tab}`
export const adminPanelId = (tab: AdminTabId): string => `admin-panel-${tab}`

/**
 * Admin sayfasının sekme çubuğu. Aktif sekme renkle ve aria-selected ile belirtilir.
 * Dar ekranda etiketler iki satıra kırılabilir, en dar hâlde düğmeler alt satıra iner; yatay taşmaz.
 */
export default function AdminTabBar({ active, badges, onSelect }: { active: AdminTabId; badges: Record<AdminTabId, string | null>; onSelect: (tab: AdminTabId) => void }) {
  return (
    <div role="tablist" aria-label="Admin bölümleri" data-testid="admin-tabs" className="mb-4 flex min-w-0 flex-wrap gap-1 rounded-2xl border border-line bg-navy-800 p-1">
      {ADMIN_TABS.map((tab) => {
        const selected = tab.id === active
        const badge = badges[tab.id]
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={adminTabId(tab.id)}
            aria-selected={selected}
            aria-controls={adminPanelId(tab.id)}
            onClick={() => onSelect(tab.id)}
            data-testid={adminTabId(tab.id)}
            className={`flex-auto rounded-xl px-1 py-2 text-[11px] leading-tight font-bold transition-colors sm:px-3 sm:text-xs sm:tracking-wide ${selected ? 'bg-brand font-extrabold text-navy-950' : 'text-muted hover:bg-navy-700 hover:text-white'}`}
          >
            {tab.label}
            {badge && (
              <span role="img" aria-label={`Uyarı: ${badge}`} title={badge} data-testid={`admin-tab-badge-${tab.id}`} className={`ml-1 ${selected ? '' : 'text-warn'}`}>
                ⚠
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
