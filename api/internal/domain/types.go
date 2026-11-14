package domain

import "time"

type PostStatus string

const (
	PostDraft     PostStatus = "draft"
	PostPublished PostStatus = "published"
	// PostScheduled: published_at is in the future; the scheduler flips it to
	// published when due (UPDATE ... WHERE status='scheduled' AND published_at <= now()).
	PostScheduled PostStatus = "scheduled"
)

func (s PostStatus) Valid() bool { return s == PostDraft || s == PostPublished || s == PostScheduled }

type LeadStatus string

const (
	LeadNew       LeadStatus = "new"
	LeadContacted LeadStatus = "contacted"
	LeadQualified LeadStatus = "qualified"
	LeadClosed    LeadStatus = "closed"
	LeadSpam      LeadStatus = "spam"
)

func (s LeadStatus) Valid() bool {
	switch s {
	case LeadNew, LeadContacted, LeadQualified, LeadClosed, LeadSpam:
		return true
	}
	return false
}

type Channel string

const (
	ChannelEmail Channel = "email"
	ChannelLine  Channel = "line"
	ChannelPhone Channel = "phone"
)

func (c Channel) Valid() bool { return c == ChannelEmail || c == ChannelLine || c == ChannelPhone }

type Category struct {
	ID          string
	Slug        string
	Name        string
	NameTH      string
	Description string
	SortOrder   int
	PostCount   int
}

// CategoryRef is the short category form embedded in posts.
type CategoryRef struct {
	Slug   string
	Name   string
	NameTH string
}

type Cover struct {
	URL    string
	Alt    string
	Width  int
	Height int
}

type Post struct {
	ID             string
	Slug           string
	LegacySlugs    []string
	Title          string
	Excerpt        string
	BodyMarkdown   string
	CoverMediaID   *string
	Cover          *Cover
	Categories     []CategoryRef
	Author         string
	Status         PostStatus
	PublishedAt    *time.Time
	Featured       bool
	ReadingMinutes int
	SEOTitle       string
	SEODescription string
	CreatedBy      *UserRef // nil when unknown or the user was deleted
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// CategorySlugs returns the slugs of the post's categories.
func (p Post) CategorySlugs() []string {
	out := make([]string, 0, len(p.Categories))
	for _, c := range p.Categories {
		out = append(out, c.Slug)
	}
	return out
}

type Lead struct {
	ID               string
	FirstName        string
	LastName         string
	Company          string
	LineID           string
	Phone            string
	Email            string
	PreferredChannel Channel
	PreferredDate    string // YYYY-MM-DD or ""
	PreferredTime    string // HH:MM or ""
	Message          string
	ConsentAt        time.Time
	Status           LeadStatus
	Note             string
	SourcePage       string
	IP               string
	UserAgent        string
	AssignedTo       *UserRef
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type AdminUser struct {
	ID           string
	Email        string
	Name         string
	PasswordHash string
	Role         Role
	IsActive     bool
	LastLoginAt  *time.Time
	CreatedAt    time.Time

	PasswordChangedAt *time.Time
	InvitedBy         *string
}

type Session struct {
	ID          string
	AdminUserID string
	TokenHash   []byte
	CSRFToken   string
	IP          string
	UserAgent   string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	LastSeenAt  *time.Time // touched at most once per minute
}

type Media struct {
	ID           string
	StorageKey   string
	URL          string
	OriginalName string
	Mime         string
	SizeBytes    int64
	Width        int
	Height       int
	UploadedBy   *string
	Uploader     *UserRef // joined uploaded_by (nil when unknown/deleted)
	Alt          string
	UsageCount   int // live posts referencing the file (list/get queries)
	CreatedAt    time.Time
}

// Page is a 1-based pagination request.
type Page struct {
	Page    int
	PerPage int
}

func (p Page) Offset() int { return (p.Page - 1) * p.PerPage }

func TotalPages(total, perPage int) int {
	if perPage <= 0 || total <= 0 {
		return 0
	}
	return (total + perPage - 1) / perPage
}
