package server

import (
	"testing"
)

func TestParsePostgresColumns(t *testing.T) {
	out := "public\tusers\tid\tinteger\tNO\t\npublic\tusers\tname\tcharacter varying\tYES\t\npublic\torders\tid\tinteger\tNO\t\n"
	tables := parsePostgresColumns(out)
	if len(tables) != 2 {
		t.Fatalf("expected 2 tables, got %d", len(tables))
	}
	u := tables["public.users"]
	if u == nil || len(u.Columns) != 2 {
		t.Fatalf("bad users table: %+v", u)
	}
	if u.Columns[0].Nullable {
		t.Fatal("id should be NOT NULL")
	}
	if !u.Columns[1].Nullable {
		t.Fatal("name should be nullable")
	}
}

func TestApplyPostgresPKs(t *testing.T) {
	tables := parsePostgresColumns("public\tusers\tid\tinteger\tNO\t\n")
	applyPostgresPKs(tables, "public\tusers\tid\n")
	u := tables["public.users"]
	if !u.Columns[0].PK {
		t.Fatal("id should be PK")
	}
	if len(u.PrimaryKey) != 1 || u.PrimaryKey[0] != "id" {
		t.Fatalf("bad pk: %+v", u.PrimaryKey)
	}
}

func TestParsePostgresRelations(t *testing.T) {
	out := "orders_user_id_fkey\tpublic\torders\tuser_id\tpublic\tusers\tid\tNO ACTION\tNO ACTION\n"
	rels := parsePostgresRelations(out)
	if len(rels) != 1 {
		t.Fatalf("expected 1 rel, got %d", len(rels))
	}
	r := rels[0]
	if r.From.Table != "orders" || r.From.Column != "user_id" || r.To.Table != "users" || r.To.Column != "id" {
		t.Fatalf("bad rel: %+v", r)
	}
}

func TestParseSQLiteTableInfo(t *testing.T) {
	out := "0\tid\tINTEGER\t1\t\t1\n1\tname\tTEXT\t0\t'anon'\t0\n"
	tbl := parseSQLiteTableInfo("users", out)
	if len(tbl.Columns) != 2 {
		t.Fatalf("expected 2 cols, got %+v", tbl)
	}
	if tbl.Columns[0].Nullable {
		t.Fatal("id NOTNULL=1 means not nullable")
	}
	if !tbl.Columns[0].PK {
		t.Fatal("id should be pk")
	}
	if tbl.Columns[1].Default == nil || *tbl.Columns[1].Default != "'anon'" {
		t.Fatalf("bad default: %+v", tbl.Columns[1].Default)
	}
}

func TestParseSQLiteFKs(t *testing.T) {
	out := "0\t0\tusers\tuser_id\tid\tNO ACTION\tNO ACTION\tNONE\n"
	rels := parseSQLiteFKs("orders", out)
	if len(rels) != 1 {
		t.Fatalf("expected 1 rel, got %d", len(rels))
	}
	if rels[0].From.Table != "orders" || rels[0].To.Table != "users" {
		t.Fatalf("bad rel: %+v", rels[0])
	}
}

func TestIntrospectPostgresUsesRunners(t *testing.T) {
	old := psqlRunner
	defer func() { psqlRunner = old }()
	calls := 0
	psqlRunner = func(in Instance, q string) (string, error) {
		calls++
		switch calls {
		case 1:
			return "public\tusers\tid\tinteger\tNO\t\n", nil
		case 2:
			return "public\tusers\tid\n", nil
		case 3:
			return "", nil
		}
		return "", nil
	}
	in := Instance{Name: "demo", DB: "postgres", Status: "running", Database: "demo", User: "postgres", Port: 5432}
	s, err := introspectPostgres(in, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Tables) != 1 || s.Tables[0].Name != "users" {
		t.Fatalf("bad schema: %+v", s)
	}
	if !s.Tables[0].Columns[0].PK {
		t.Fatal("pk not applied")
	}
}
