/** Temkinli sıralamada kullanılan, örnekleme göre düzeltilmiş yüzde. Ham yüzdenin yerine geçmez. */
export default function CautiousBadge({ value }: { value: number | null }) {
  return (
    <span
      title="Örneklem büyüklüğüne göre düzeltilmiş alt sınır (Wilson, %95). Sadece sıralama için kullanılır."
      className="inline-flex items-center gap-1 rounded-full border border-info-line bg-info-soft px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-info"
    >
      <span className="font-normal opacity-80">Temkinli:</span>
      {value !== null ? `%${value}` : 'hesaplanamadı'}
    </span>
  )
}
