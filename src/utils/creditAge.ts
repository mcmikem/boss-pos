export function daysOverdue(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (24*60*60*1000));
  return diff;
}
export function ageingBucket(days: number): 'current' | '7d' | '30d' | 'overdue' {
  if (days <= 7) return 'current';
  if (days <= 30) return '7d';
  return 'overdue';
}
