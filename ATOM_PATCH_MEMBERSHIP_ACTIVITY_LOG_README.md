# Membership Activity Log (Admin)

This patch adds a new page:

- `/admin/membership-activity`

It reads from the `audit_logs` table (already used by existing admin actions).

## Add to menus (optional)

Because your menu files may already have custom edits, I did NOT overwrite them automatically.

### Top menu (AppNav)
Add a new item for admin / super_admin:
- Label: `Activity Log`
- Href: `/admin/membership-activity`
- Icon: `file-text`

### Home menu (Home tiles)
Add a new tile for admin / super_admin:
- Label: `Activity Log`
- Href: `/admin/membership-activity`
- Icon: `FileText`

If you want, send me your current `src/components/AppNav.tsx` and `src/app/page.tsx`,
and I'll generate a precise patch that injects the menu entry without overwriting anything else.
