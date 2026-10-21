package server

import (
	"os"
	"strings"
	"testing"
)

func TestClampQueryLimit(t *testing.T) {
	if got := clampQueryLimit(0); got != defaultQueryLimit {
		t.Fatalf("default: got %d", got)
	}
	if got := clampQueryLimit(-4); got != defaultQueryLimit {
		t.Fatalf("negative: got %d", got)
	}
	if got := clampQueryLimit(9999); got != maxQueryLimit {
		t.Fatalf("max: got %d", got)
	}
	if got := clampQueryLimit(50); got != 50 {
		t.Fatalf("passthrough: got %d", got)
	}
}

func TestNormalizeStatement(t *testing.T) {
	cases := map[string]string{
		"  select 1  ":  "select 1",
		"select 1;":     "select 1",
		"select 1 ;;\n": "select 1",
		"select ';' ;":  "select ';'",
		"":              "",
	}
	for in, want := range cases {
		if got := normalizeStatement(in); got != want {
			t.Fatalf("normalize %q: got %q want %q", in, got, want)
		}
	}
}

func TestClassifyStatement(t *testing.T) {
	cases := map[string]statementKind{
		"select 1":                             statementRows,
		"WITH x AS (select 1) select * from x": statementRows,
		"values (1),(2)":                       statementRows,
		"table users":                          statementRows,
		"/* hi */ SELECT 1":                    statementRows,
		"-- hi\nSELECT 1":                      statementRows,
		"explain select 1":                     statementRowsNoWrap,
		"show work_mem":                        statementRowsNoWrap,
		"pragma table_info(t)":                 statementRowsNoWrap,
		"update t set x = 1":                   statementCommand,
		"insert into t values (1)":             statementCommand,
		"":                                     statementCommand,
	}
	for in, want := range cases {
		if got := classifyStatement(in); got != want {
			t.Fatalf("classify %q: got %d want %d", in, got, want)
		}
	}
}

func TestParsePSQLCSV(t *testing.T) {
	out := "id,name,note\n1,alice," + QueryNullMarker + "\n2,\"bob, jr\",\"line1\nline2\"\n"
	res, err := parsePSQLCSV(out, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Columns) != 3 || res.Columns[0] != "id" {
		t.Fatalf("columns: %+v", res.Columns)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("rows: %d", len(res.Rows))
	}
	if res.Rows[0][2] != nil {
		t.Fatal("null marker should map to nil")
	}
	if got := *res.Rows[1][1]; got != "bob, jr" {
		t.Fatalf("quoted comma: %q", got)
	}
	if got := *res.Rows[1][2]; got != "line1\nline2" {
		t.Fatalf("quoted newline: %q", got)
	}
	if res.Truncated || res.RowCount != 2 {
		t.Fatalf("unexpected meta: %+v", res)
	}
}

func TestParsePSQLCSVTruncates(t *testing.T) {
	out := "a\n1\n2\n3\n"
	res, err := parsePSQLCSV(out, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated || len(res.Rows) != 2 {
		t.Fatalf("expected truncation, got %+v", res)
	}
}

func TestParsePSQLCSVCommandTag(t *testing.T) {
	res, err := parsePSQLCSV("UPDATE 3\n", 100)
	if err != nil {
		t.Fatal(err)
	}
	if res.Command != "UPDATE 3" {
		t.Fatalf("command: %q", res.Command)
	}
	if len(res.Rows) != 0 {
		t.Fatalf("command should have no rows: %+v", res.Rows)
	}
}

func TestParsePSQLCSVEmptySelect(t *testing.T) {
	res, err := parsePSQLCSV("answer\n", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Columns) != 1 || res.Columns[0] != "answer" {
		t.Fatalf("columns: %+v", res.Columns)
	}
	if len(res.Rows) != 0 {
		t.Fatalf("rows: %+v", res.Rows)
	}
}

func TestParseSQLiteJSON(t *testing.T) {
	out := `[{"i":1,"f":1.5,"n":null,"s":"x","b":true},{"i":2,"f":null,"n":"", "s":null,"b":false}]`
	cols, rows, err := parseSQLiteJSON(out)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"i", "f", "n", "s", "b"}
	if len(cols) != len(want) {
		t.Fatalf("columns: %+v", cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Fatalf("column %d: got %q want %q", i, cols[i], want[i])
		}
	}
	if len(rows) != 2 {
		t.Fatalf("rows: %d", len(rows))
	}
	if rows[0][2] != nil {
		t.Fatal("json null should map to nil")
	}
	if got := *rows[0][0]; got != "1" {
		t.Fatalf("number: %q", got)
	}
	if got := *rows[0][1]; got != "1.5" {
		t.Fatalf("float: %q", got)
	}
	if got := *rows[1][2]; got != "" {
		t.Fatalf("empty string: %q", got)
	}
	if got := *rows[0][4]; got != "true" {
		t.Fatalf("bool: %q", got)
	}
}

func TestParseSQLiteJSONEmpty(t *testing.T) {
	cols, rows, err := parseSQLiteJSON("   ")
	if err != nil {
		t.Fatal(err)
	}
	if len(cols) != 0 || len(rows) != 0 {
		t.Fatalf("expected empty result, got %+v %+v", cols, rows)
	}
}

func TestParseSQLiteJSONDuplicateAndOrder(t *testing.T) {
	cols, rows, err := parseSQLiteJSON(`[{"a":1,"a":2}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(cols) != 2 || cols[0] != "a" || cols[1] != "a" {
		t.Fatalf("columns: %+v", cols)
	}
	if len(rows) != 1 || *rows[0][0] != "1" || *rows[0][1] != "2" {
		t.Fatalf("rows: %+v", rows)
	}
}

func TestQueryPostgresWrapsSelect(t *testing.T) {
	old := psqlExec
	defer func() { psqlExec = old }()
	var seen string
	psqlExec = func(in Instance, query string, csvOutput bool) (string, error) {
		seen = query
		return "a\n1\n2\n", nil
	}
	in := Instance{Name: "demo", DB: "postgres", User: "postgres", Database: "demo", Port: 5432}
	res, err := queryPostgres(in, "select * from t;", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(seen, "COPY (SELECT * FROM (select * from t) AS _dbeed_q LIMIT 2)") {
		t.Fatalf("unexpected query: %s", seen)
	}
	if !res.Truncated || len(res.Rows) != 1 {
		t.Fatalf("expected one truncated row: %+v", res)
	}
}

func TestQuerySQLiteCommandSkipsJSON(t *testing.T) {
	old := sqliteExec
	defer func() { sqliteExec = old }()
	var jsonMode bool
	sqliteExec = func(dbFile, query string, jsonOutput bool) (string, error) {
		jsonMode = jsonOutput
		return "", nil
	}
	in := Instance{Name: "demo", DB: "sqlite", DataDir: t.TempDir()}
	if err := os.WriteFile(in.DataDir+"/db.sqlite", nil, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := querySQLite(in, "create table t(i int)", 10)
	if err != nil {
		t.Fatal(err)
	}
	if jsonMode {
		t.Fatal("command statements must not use -json")
	}
	if res.Command != "ok" {
		t.Fatalf("command: %q", res.Command)
	}
}

func TestRunQueryRejectsEmptySQL(t *testing.T) {
	if _, err := RunQuery(Instance{DB: "postgres"}, "   ;  ", 10); err == nil {
		t.Fatal("expected error for empty sql")
	}
}
