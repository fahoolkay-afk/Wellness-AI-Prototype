// Roles and permissions, enforced on the server (default deny). Mirrors the EHRM's model:
// each role gets the minimum it needs (PHIPA s.30, minimum necessary).

export const ROLES = ["owner", "front_desk", "practitioner", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "inbox.read", "inbox.reply", "inbox.manage", "drafts.approve",
  "contacts.read", "contacts.write", "contacts.export", "contacts.erase", "consent.write", "proposals.decide",
  "calendar.read", "calendar.write",
  "tasks.read", "tasks.write",
  "calls.read",
  "broadcast.send", "automations.manage", "settings.manage", "users.manage",
  "audit.read", "stats.read",
  "simulator.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const FRONT_DESK: Permission[] = [
  "inbox.read", "inbox.reply", "inbox.manage", "drafts.approve",
  "contacts.read", "contacts.write", "consent.write", "proposals.decide",
  "calendar.read", "calendar.write", "tasks.read", "tasks.write", "calls.read", "stats.read", "simulator.use",
];

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  front_desk: new Set(FRONT_DESK),
  // Practitioners see their schedule and the conversation context, but don't run the desk or export data.
  practitioner: new Set<Permission>(["inbox.read", "contacts.read", "calendar.read", "tasks.read", "tasks.write", "stats.read"]),
  // Auditors oversee access and activity without opening patient conversations.
  auditor: new Set<Permission>(["audit.read", "stats.read"]),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.has(permission) ?? false;
}

export function permissionsOf(role: Role): Permission[] {
  return [...(GRANTS[role] ?? [])];
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  front_desk: "Front desk",
  practitioner: "Practitioner",
  auditor: "Auditor",
};
