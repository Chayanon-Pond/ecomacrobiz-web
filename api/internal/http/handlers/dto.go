package handlers

import (
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type coverDTO struct {
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type categoryRefDTO struct {
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	NameTH string `json:"name_th"`
}

type categoryDTO struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	NameTH      string `json:"name_th"`
	Description string `json:"description"`
	PostCount   int    `json:"post_count"`
}

type postSummaryDTO struct {
	ID             string           `json:"id"`
	Slug           string           `json:"slug"`
	Title          string           `json:"title"`
	Excerpt        string           `json:"excerpt"`
	Cover          *coverDTO        `json:"cover"`
	Categories     []categoryRefDTO `json:"categories"`
	Author         string           `json:"author"`
	PublishedAt    *time.Time       `json:"published_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
	ReadingMinutes int              `json:"reading_minutes"`
	Featured       bool             `json:"featured"`
	SEOTitle       string           `json:"seo_title"`
	SEODescription string           `json:"seo_description"`
	Status         string           `json:"status,omitempty"` // admin only
}

type postDTO struct {
	postSummaryDTO
	BodyMarkdown string   `json:"body_markdown"`
	LegacySlugs  []string `json:"legacy_slugs"`
	CoverMediaID *string  `json:"cover_media_id,omitempty"` // admin only
}

func toCategories(cs []domain.Category) []categoryDTO {
	out := make([]categoryDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, categoryDTO{Slug: c.Slug, Name: c.Name, NameTH: c.NameTH, Description: c.Description,
			PostCount: c.PostCount})
	}
	return out
}

func toSummary(p domain.Post, admin bool) postSummaryDTO {
	d := postSummaryDTO{
		ID: p.ID, Slug: p.Slug, Title: p.Title, Excerpt: p.Excerpt, Author: p.Author,
		Categories: make([]categoryRefDTO, 0, len(p.Categories)), UpdatedAt: p.UpdatedAt.UTC(),
		ReadingMinutes: p.ReadingMinutes, Featured: p.Featured, SEOTitle: p.SEOTitle, SEODescription: p.SEODescription,
	}
	if p.PublishedAt != nil {
		t := p.PublishedAt.UTC()
		d.PublishedAt = &t
	}
	if p.Cover != nil {
		d.Cover = &coverDTO{URL: p.Cover.URL, Alt: p.Cover.Alt, Width: p.Cover.Width, Height: p.Cover.Height}
	}
	for _, c := range p.Categories {
		d.Categories = append(d.Categories, categoryRefDTO{Slug: c.Slug, Name: c.Name, NameTH: c.NameTH})
	}
	if admin {
		d.Status = string(p.Status)
	}
	return d
}

func toSummaries(ps []domain.Post, admin bool) []postSummaryDTO {
	out := make([]postSummaryDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, toSummary(p, admin))
	}
	return out
}

func toPost(p domain.Post, admin bool) postDTO {
	d := postDTO{postSummaryDTO: toSummary(p, admin), BodyMarkdown: p.BodyMarkdown, LegacySlugs: p.LegacySlugs}
	if d.LegacySlugs == nil {
		d.LegacySlugs = []string{}
	}
	if admin {
		d.CoverMediaID = p.CoverMediaID
	}
	return d
}

type leadDTO struct {
	ID               string      `json:"id"`
	FirstName        string      `json:"first_name"`
	LastName         string      `json:"last_name"`
	Company          string      `json:"company"`
	LineID           string      `json:"line_id"`
	Phone            string      `json:"phone"`
	Email            string      `json:"email"`
	PreferredChannel string      `json:"preferred_channel"`
	PreferredDate    *string     `json:"preferred_date"`
	PreferredTime    *string     `json:"preferred_time"`
	Message          string      `json:"message"`
	ConsentAt        time.Time   `json:"consent_at"`
	Status           string      `json:"status"`
	Note             string      `json:"note"`
	SourcePage       string      `json:"source_page"`
	IP               string      `json:"ip"`
	UserAgent        string      `json:"user_agent"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
	AssignedTo       *userRefDTO `json:"assigned_to"`
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func toLead(l domain.Lead) leadDTO {
	return leadDTO{
		ID: l.ID, FirstName: l.FirstName, LastName: l.LastName, Company: l.Company, LineID: l.LineID,
		Phone: l.Phone, Email: l.Email, PreferredChannel: string(l.PreferredChannel),
		PreferredDate: strPtr(l.PreferredDate), PreferredTime: strPtr(l.PreferredTime), Message: l.Message,
		ConsentAt: l.ConsentAt.UTC(), Status: string(l.Status), Note: l.Note, SourcePage: l.SourcePage, IP: l.IP,
		UserAgent: l.UserAgent, CreatedAt: l.CreatedAt.UTC(), UpdatedAt: l.UpdatedAt.UTC(),
		AssignedTo: toUserRef(l.AssignedTo),
	}
}

func toLeads(ls []domain.Lead) []leadDTO {
	out := make([]leadDTO, 0, len(ls))
	for _, l := range ls {
		out = append(out, toLead(l))
	}
	return out
}

type userDTO struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func toUser(u domain.AdminUser) userDTO { return userDTO{ID: u.ID, Email: u.Email, Name: u.Name} }

// userRefDTO is the shared short user form (CONTRACT "UserRef").
type userRefDTO struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// toUserRef returns nil for a nil ref (JSON null).
func toUserRef(r *domain.UserRef) *userRefDTO {
	if r == nil {
		return nil
	}
	return &userRefDTO{ID: r.ID, Name: r.Name, Email: r.Email}
}
