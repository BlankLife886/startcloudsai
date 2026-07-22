package auth

import "testing"

func TestPasswordPolicies(t *testing.T) {
	if ValidateUserPassword("1234567") == nil || ValidateUserPassword("12345678") != nil {
		t.Fatal("user password policy must require at least 8 bytes")
	}
	if ValidateAdminPassword("12345678901") == nil || ValidateAdminPassword("123456789012") != nil {
		t.Fatal("admin password policy must require at least 12 bytes")
	}
	tooLong := make([]byte, MaxPasswordBytes+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}
	if ValidateUserPassword(string(tooLong)) == nil || ValidateAdminPassword(string(tooLong)) == nil {
		t.Fatal("bcrypt 72-byte limit must be enforced")
	}
}
