// Package domain holds the core types shared by every layer and the error
// values the HTTP layer maps onto the API error envelope.
package domain

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	// ErrConflict is returned by repositories on unique violations (e.g. slug).
	ErrConflict = errors.New("conflict")
	// ErrTooLarge maps to 413 payload_too_large.
	ErrTooLarge = errors.New("payload too large")
)

// ValidationError carries per-field Thai messages for a 422 response.
type ValidationError struct {
	Message string
	Fields  map[string]string
}

func (e *ValidationError) Error() string {
	if e.Message != "" {
		return "validation failed: " + e.Message
	}
	return "validation failed"
}

// Validator accumulates field errors; the first message per field wins.
type Validator struct {
	fields map[string]string
}

func (v *Validator) Add(field, msg string) {
	if v.fields == nil {
		v.fields = map[string]string{}
	}
	if _, ok := v.fields[field]; !ok {
		v.fields[field] = msg
	}
}

func (v *Validator) Has(field string) bool {
	_, ok := v.fields[field]
	return ok
}

func (v *Validator) Valid() bool { return len(v.fields) == 0 }

// Err returns nil when there are no field errors.
func (v *Validator) Err() error {
	if v.Valid() {
		return nil
	}
	return &ValidationError{Message: MsgValidationFailed, Fields: v.fields}
}

// Common Thai messages.
const (
	MsgValidationFailed = "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง"
	MsgInvalidJSON      = "รูปแบบข้อมูลไม่ถูกต้อง"
	MsgNotFound         = "ไม่พบข้อมูลที่ต้องการ"
	MsgUnauthorized     = "กรุณาเข้าสู่ระบบ"
	MsgForbidden        = "ไม่มีสิทธิ์ดำเนินการ"
	MsgRateLimited      = "มีการส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง"
	MsgPayloadTooLarge  = "ข้อมูลมีขนาดใหญ่เกินกำหนด"
	MsgInternal         = "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง"
	MsgInvalidLogin     = "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
)
