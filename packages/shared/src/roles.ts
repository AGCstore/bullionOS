export const USER_ROLES = ['admin', 'staff', 'client'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'restricted', 'disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
