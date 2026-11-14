package service

import "github.com/ecomacrobiz/escoma/api/internal/repository/fake"

type nopRevalidator struct{}

func (nopRevalidator) Revalidate(...string) {}

func testRedirects(store *fake.Store) *RedirectService {
	return NewRedirectService(store.RedirectsRepo(), store.PostsRepo(), nopRevalidator{}, NopAuditor{}, discard)
}
