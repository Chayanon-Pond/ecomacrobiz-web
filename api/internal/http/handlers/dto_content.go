package handlers

import (
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// ---- admin posts ----

type adminPostSummaryDTO struct {
	postSummaryDTO
	CreatedBy *userRefDTO `json:"created_by"`
}

type adminPostDTO struct {
	postDTO
	CreatedBy *userRefDTO `json:"created_by"`
}

func toAdminSummaries(ps []domain.Post) []adminPostSummaryDTO {
	out := make([]adminPostSummaryDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, adminPostSummaryDTO{postSummaryDTO: toSummary(p, true), CreatedBy: toUserRef(p.CreatedBy)})
	}
	return out
}

func toAdminPost(p domain.Post) adminPostDTO {
	return adminPostDTO{postDTO: toPost(p, true), CreatedBy: toUserRef(p.CreatedBy)}
}

// ---- media ----

type mediaDTO struct {
	ID           string      `json:"id"`
	URL          string      `json:"url"`
	OriginalName string      `json:"original_name"`
	Mime         string      `json:"mime"`
	Size         int64       `json:"size"`
	Width        int         `json:"width"`
	Height       int         `json:"height"`
	Alt          string      `json:"alt"`
	CreatedAt    time.Time   `json:"created_at"`
	UploadedBy   *userRefDTO `json:"uploaded_by"`
	UsageCount   int         `json:"usage_count"`
}

type mediaUsageDTO struct {
	PostID string `json:"post_id"`
	Title  string `json:"title"`
	Slug   string `json:"slug"`
	Status string `json:"status"`
	Kind   string `json:"kind"`
}

type mediaDetailDTO struct {
	mediaDTO
	Usage []mediaUsageDTO `json:"usage"`
}

func toMedia(m domain.Media) mediaDTO {
	return mediaDTO{ID: m.ID, URL: m.URL, OriginalName: m.OriginalName, Mime: m.Mime, Size: m.SizeBytes,
		Width: m.Width, Height: m.Height, Alt: m.Alt, CreatedAt: m.CreatedAt.UTC(), UploadedBy: toUserRef(m.Uploader),
		UsageCount: m.UsageCount}
}

func toMediaList(ms []domain.Media) []mediaDTO {
	out := make([]mediaDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMedia(m))
	}
	return out
}

func toMediaDetail(m domain.Media, usage []domain.MediaUsage) mediaDetailDTO {
	d := mediaDetailDTO{mediaDTO: toMedia(m), Usage: make([]mediaUsageDTO, 0, len(usage))}
	for _, u := range usage {
		d.Usage = append(d.Usage, mediaUsageDTO{PostID: u.PostID, Title: u.Title, Slug: u.Slug,
			Status: string(u.Status), Kind: u.Kind})
	}
	return d
}

// ---- leads ----

type leadActivityDTO struct {
	ID        string      `json:"id"`
	Kind      string      `json:"kind"`
	Actor     *userRefDTO `json:"actor"`
	Body      string      `json:"body"`
	From      string      `json:"from"`
	To        string      `json:"to"`
	CreatedAt time.Time   `json:"created_at"`
}

// toActivity: when the acting user was deleted, actor keeps the name
// snapshot (id "" / email "").
func toActivity(a domain.LeadActivity) leadActivityDTO {
	d := leadActivityDTO{ID: a.ID, Kind: a.Kind, Actor: toUserRef(a.Actor), Body: a.Body, From: a.From, To: a.To,
		CreatedAt: a.CreatedAt.UTC()}
	if d.Actor == nil && a.ActorName != "" {
		d.Actor = &userRefDTO{Name: a.ActorName}
	}
	return d
}

func toActivities(as []domain.LeadActivity) []leadActivityDTO {
	out := make([]leadActivityDTO, 0, len(as))
	for _, a := range as {
		out = append(out, toActivity(a))
	}
	return out
}

type leadBoardDTO struct {
	Columns map[domain.LeadStatus][]leadDTO `json:"columns"`
	Counts  map[domain.LeadStatus]int       `json:"counts"`
}

func toBoard(b service.LeadBoard) leadBoardDTO {
	d := leadBoardDTO{Columns: map[domain.LeadStatus][]leadDTO{}, Counts: b.Counts}
	for st, ls := range b.Columns {
		d.Columns[st] = toLeads(ls)
	}
	return d
}

func toUserRefs(us []domain.UserRef) []userRefDTO {
	out := make([]userRefDTO, 0, len(us))
	for _, u := range us {
		out = append(out, userRefDTO{ID: u.ID, Name: u.Name, Email: u.Email})
	}
	return out
}

// ---- dashboard ----

type dayCountDTO struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type dashboardLeadsDTO struct {
	Today     int                       `json:"today"`
	Yesterday int                       `json:"yesterday"`
	Last7     int                       `json:"last7"`
	Prev7     int                       `json:"prev7"`
	Last30    int                       `json:"last30"`
	Prev30    int                       `json:"prev30"`
	ByStatus  map[domain.LeadStatus]int `json:"by_status"`
	Daily     []dayCountDTO             `json:"daily"`
	Recent    []leadDTO                 `json:"recent"`
}

type dashboardPostsDTO struct {
	Published       int                   `json:"published"`
	Drafts          int                   `json:"drafts"`
	Scheduled       int                   `json:"scheduled"`
	NextScheduledAt *time.Time            `json:"next_scheduled_at"`
	Recent          []adminPostSummaryDTO `json:"recent"`
}

type dashboardDTO struct {
	Leads *dashboardLeadsDTO `json:"leads"`
	Posts *dashboardPostsDTO `json:"posts"`
}

func toDashboardLeads(d service.DashboardLeads) *dashboardLeadsDTO {
	out := &dashboardLeadsDTO{Today: d.Today, Yesterday: d.Yesterday, Last7: d.Last7, Prev7: d.Prev7,
		Last30: d.Last30, Prev30: d.Prev30, ByStatus: map[domain.LeadStatus]int{},
		Daily: make([]dayCountDTO, 0, len(d.Daily)), Recent: toLeads(d.Recent)}
	for _, st := range service.LeadStatuses {
		out.ByStatus[st] = d.ByStatus[st]
	}
	for _, x := range d.Daily {
		out.Daily = append(out.Daily, dayCountDTO{Date: x.Date, Count: x.Count})
	}
	return out
}

func toDashboardPosts(d service.DashboardPosts) *dashboardPostsDTO {
	out := &dashboardPostsDTO{Published: d.Published, Drafts: d.Drafts, Scheduled: d.Scheduled,
		Recent: toAdminSummaries(d.Recent)}
	if d.NextScheduledAt != nil {
		t := d.NextScheduledAt.UTC()
		out.NextScheduledAt = &t
	}
	return out
}
