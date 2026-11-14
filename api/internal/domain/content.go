package domain

import (
	"errors"
	"fmt"
	"time"
)

// ErrNoPermission: the role lacks a permission checked inside a service
// (e.g. publishing without posts:publish). 403 forbidden + MsgNoPermission.
var ErrNoPermission = errors.New("missing permission")

// InUseError: the media file is still referenced by live posts (409 in_use).
type InUseError struct{ Count int }

func (e *InUseError) Error() string { return fmt.Sprintf("in use by %d posts", e.Count) }

// Message is the Thai 409 message.
func (e *InUseError) Message() string {
	return fmt.Sprintf("ไฟล์นี้ถูกใช้งานอยู่ใน %d บทความ", e.Count)
}

// PostRef is the minimal post identity returned by bulk/scheduler updates.
type PostRef struct {
	ID          string
	Slug        string
	LegacySlugs []string
}

// MediaUsage is one live post that references a media file.
type MediaUsage struct {
	PostID string
	Title  string
	Slug   string
	Status PostStatus
	Kind   string // "cover" | "body"
}

// LeadActivityKind values (lead_activities.kind).
const (
	LeadActivityNote   = "note"
	LeadActivityStatus = "status"
	LeadActivityAssign = "assign"
)

// LeadActivity is one entry of a lead's timeline.
type LeadActivity struct {
	ID        string
	LeadID    string
	ActorID   *string
	ActorName string   // snapshot at write time
	Actor     *UserRef // joined when the user still exists
	Kind      string
	Body      string
	From      string
	To        string
	CreatedAt time.Time
}

// LeadStats is the dashboard lead section (counts by Asia/Bangkok day).
type LeadStats struct {
	Today, Yesterday int
	Last7, Prev7     int
	Last30, Prev30   int
	ByStatus         map[LeadStatus]int
	Daily            []DayCount // 30 days, oldest first, zero-filled
}

type DayCount struct {
	Date  string // YYYY-MM-DD (Asia/Bangkok)
	Count int
}

// PostStats is the dashboard post section.
type PostStats struct {
	Published, Drafts, Scheduled int
	NextScheduledAt              *time.Time
}
