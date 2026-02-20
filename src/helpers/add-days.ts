export function addDays(date: string, days: number): string {
  const parsedDate = new Date(date);
  const result = new Date(parsedDate.getTime() + days * 24 * 60 * 60 * 1000);
  return result.toISOString(); // bisa diganti format lain kalau perlu
}
