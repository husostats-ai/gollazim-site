export const APP_TIME_ZONE = 'Europe/Istanbul'

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Bir anı Türkiye saatine göre { date: YYYY-MM-DD, time: HH:mm } olarak verir */
export const toAppDateTime = (instant: Date): { date: string; time: string } => ({
  date: dateFmt.format(instant),
  time: timeFmt.format(instant),
})

export const todayInAppZone = (): string => toAppDateTime(new Date()).date
