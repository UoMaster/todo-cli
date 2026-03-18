/**
 * 解析用户输入的时间字符串
 * 支持的格式:
 * - 30m / 2h / 3d / 1w - 相对时间
 * - tomorrow - 明天
 * - mon/tue/wed/thu/fri/sat/sun - 下周某
 * - YYYY-MM-DD - 具体日期
 */
export function parseDueDate(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  const now = new Date();

  // 相对时间: 30m, 2h, 3d, 1w
  const relativeMatch = trimmed.match(/^(\d+)([mhdw])$/);
  if (relativeMatch) {
    const [, num, unit] = relativeMatch;
    const date = new Date(now);
    const n = parseInt(num);
    switch (unit) {
      case 'm': date.setMinutes(date.getMinutes() + n); break;
      case 'h': date.setHours(date.getHours() + n); break;
      case 'd': date.setDate(date.getDate() + n); break;
      case 'w': date.setDate(date.getDate() + n * 7); break;
    }
    return date.toISOString();
  }

  // 明天
  if (trimmed === 'tomorrow' || trimmed === 'tmr') {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0); // 默认早上9点
    return date.toISOString();
  }

  // 本周/下周某天 mon, tue, wed, thu, fri, sat, sun
  const dayMap: Record<string, number> = {
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
    sun: 0, sunday: 0,
  };
  if (dayMap[trimmed] !== undefined) {
    const targetDay = dayMap[trimmed];
    const date = new Date(now);
    const currentDay = date.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // 下周
    date.setDate(date.getDate() + daysUntil);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  // 具体日期 YYYY-MM-DD 或 MM-DD
  const dateMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 9, 0, 0);
    return date.toISOString();
  }

  // 简写 MM-DD
  const shortDateMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})$/);
  if (shortDateMatch) {
    const [, month, day] = shortDateMatch;
    const date = new Date(now.getFullYear(), parseInt(month) - 1, parseInt(day), 9, 0, 0);
    // 如果日期已过，设为明年
    if (date < now) {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }

  return undefined;
}

/**
 * 格式化显示时间
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  // 已过期
  if (diff < 0) {
    const hours = Math.floor(-diff / (60 * 60 * 1000));
    if (hours < 24) return `${hours}小时前过期`;
    const days = Math.floor(hours / 24);
    return `${days}天前过期`;
  }

  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}分钟后`;
  }

  // 小于24小时显示相对时间
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}小时后`;
  }

  // 小于7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天后`;
  }

  // 否则显示 MM-DD
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * 判断是否过期
 */
export function isOverdue(isoString: string): boolean {
  return new Date(isoString) < new Date();
}

/**
 * 判断是否即将到期（24小时内）
 */
export function isDueSoon(isoString: string): boolean {
  const diff = new Date(isoString).getTime() - new Date().getTime();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}
