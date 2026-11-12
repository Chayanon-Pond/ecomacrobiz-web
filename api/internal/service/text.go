// Package service holds the business rules: validation (with Thai field
// messages), orchestration of repositories, storage and notifications.
package service

import (
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var bangkok = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*3600)
}()

// Bangkok is Asia/Bangkok (UTC+7, no DST).
func Bangkok() *time.Location { return bangkok }

// cleanLine trims and removes control characters from a single-line value.
func cleanLine(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}

// cleanText trims, normalises newlines and drops control characters other
// than newline and tab.
func cleanText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

func truncateRunes(s string, n int) string {
	if runeLen(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
