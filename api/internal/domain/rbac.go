package domain

import "slices"

// Role is an admin user's role. The role -> permission map below is the
// single source of truth (mirrored for cosmetic UI hiding in
// web/src/lib/admin/permissions.ts; the API always enforces).
type Role string

const (
	RoleOwner  Role = "owner"
	RoleEditor Role = "editor"
	RoleSales  Role = "sales"
	RoleViewer Role = "viewer"
)

// Roles in display order (most privileged first).
var Roles = []Role{RoleOwner, RoleEditor, RoleSales, RoleViewer}

func (r Role) Valid() bool { return slices.Contains(Roles, r) }

// Permission is a capability checked by middleware.RequirePerm and services.
type Permission string

const (
	PermPostsRead      Permission = "posts:read"
	PermPostsWrite     Permission = "posts:write"
	PermPostsPublish   Permission = "posts:publish"
	PermMediaRead      Permission = "media:read"
	PermMediaWrite     Permission = "media:write"
	PermLeadsRead      Permission = "leads:read"
	PermLeadsWrite     Permission = "leads:write"
	PermLeadsExport    Permission = "leads:export"
	PermUsersRead      Permission = "users:read"
	PermUsersManage    Permission = "users:manage"
	PermAuditRead      Permission = "audit:read"
	PermSettingsManage Permission = "settings:manage"
)

// AllPermissions in a stable order (used for owner and for /auth/me output).
var AllPermissions = []Permission{
	PermPostsRead, PermPostsWrite, PermPostsPublish,
	PermMediaRead, PermMediaWrite,
	PermLeadsRead, PermLeadsWrite, PermLeadsExport,
	PermUsersRead, PermUsersManage,
	PermAuditRead, PermSettingsManage,
}

// RolePermissions is the role -> permission matrix.
//
//	owner  : everything
//	editor : content (posts incl. publish, media)
//	sales  : leads (read, update/notes/assign, export)
//	viewer : read-only posts, media and leads (no export, no PII download)
var RolePermissions = map[Role][]Permission{
	RoleOwner:  AllPermissions,
	RoleEditor: {PermPostsRead, PermPostsWrite, PermPostsPublish, PermMediaRead, PermMediaWrite},
	RoleSales:  {PermLeadsRead, PermLeadsWrite, PermLeadsExport},
	RoleViewer: {PermPostsRead, PermMediaRead, PermLeadsRead},
}

// PermissionsOf returns the role's permissions (nil for an unknown role).
func PermissionsOf(r Role) []Permission { return RolePermissions[r] }

// Has reports whether the role grants p. Unknown roles grant nothing.
func (r Role) Has(p Permission) bool { return slices.Contains(RolePermissions[r], p) }

// HasAny reports whether the role grants at least one of ps.
func (r Role) HasAny(ps ...Permission) bool {
	for _, p := range ps {
		if r.Has(p) {
			return true
		}
	}
	return false
}

// MsgNoPermission is the 403 message for a missing permission (distinct from
// MsgForbidden, which is used for CSRF/origin failures).
const MsgNoPermission = "บัญชีของคุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ (Owner)"
