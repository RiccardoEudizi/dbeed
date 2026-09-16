package server

import (
	"testing"
)

func TestClampRowsPage(t *testing.T) {
	l, o := clampRowsPage(0, -5)
	if l != 100 || o != 0 {
		t.Fatalf("defaults: got %d,%d", l, o)
	}
	l, o = clampRowsPage(9999, 10)
	if l != 500 || o != 10 {
		t.Fatalf("max clamp: got %d,%d", l, o)
	}
}

func TestParseRowsTSV(t *testing.T) {
	out := "1\talice\t" + NullMarker + "\n2\tbob\t30\n"
	rows := parseRowsTSV(out, 3)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[0][2] != nil {
		t.Fatal("marker should map to nil")
	}
	if rows[0][0] == nil || *rows[0][0] != "1" {
		t.Fatalf("bad cell: %+v", rows[0][0])
	}
	// ragged line pads to column count
	rows = parseRowsTSV("a\n", 3)
	if len(rows) != 1 || rows[0][1] == nil || *rows[0][1] != "" {
		t.Fatalf("ragged pad: %+v", rows)
	}
	if len(parseRowsTSV("", 2)) != 0 {
		t.Fatal("empty output should give no rows")
	}
}

func TestQueryRowsRejectsUnknownTable(t *testing.T) {
	old := psqlRunner
	defer func() { psqlRunner = old }()
	psqlRunner = func(in Instance, q string) (string, error) { return "", nil }
	in := Instance{Name: "demo", DB: "postgres", Status: "running", Database: "demo", User: "postgres", Port: 5432}
	if _, err := QueryRows(in, "nope", 10, 0); err == nil {
		t.Fatal("expected error for unknown table")
	}
	if _, err := QueryRows(in, "", 10, 0); err == nil {
		t.Fatal("expected error for empty table")
	}
}
