export function eligibleDriverSql(alias: string, nowRef: string) {
  return `(${alias}.status = 'approved' AND (${alias}.approval_expires_at IS NULL OR ${alias}.approval_expires_at > ${nowRef}))`;
}
