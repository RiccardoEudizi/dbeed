package server

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// --- schema types ---

type SchemaColumn struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  *string `json:"default,omitempty"`
	PK       bool   `json:"pk,omitempty"`
}

type SchemaTable struct {
	Name       string         `json:"name"`
	Schema     string         `json:"schema"`
	Columns    []SchemaColumn `json:"columns"`
	PrimaryKey []string       `json:"primaryKey,omitempty"`
	RowCount   *int64         `json:"rowCount,omitempty"`
}

type SchemaRef struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

type SchemaRelation struct {
	Name string    `json:"name"`
	From SchemaRef `json:"from"`
	To   SchemaRef `json:"to"`
}

type SchemaResponse struct {
	Database  string           `json:"database"`
	DB        string           `json:"db"`
	Tables    []SchemaTable    `json:"tables"`
	Relations []SchemaRelation `json:"relations"`
}

// MissingCLIError is returned when psql/sqlite3 is absent.
type MissingCLIError struct {
	CLI string
	Hint string
}

func (e *MissingCLIError) Error() string {
	return fmt.Sprintf("%s not found on PATH. %s", e.CLI, e.Hint)
}

// Introspect dispatches by db type.
func IntrospectSchema(in Instance, withCounts bool) (SchemaResponse, error) {
	switch in.DB {
	case "postgres":
		return introspectPostgres(in, withCounts)
	case "sqlite":
		return introspectSQLite(in, withCounts)
	default:
		return SchemaResponse{}, fmt.Errorf("schema introspection unsupported for db %q", in.DB)
	}
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// --- postgres ---

var psqlRunner = func(in Instance, query string) (string, error) {
	psql := lookPath("psql")
	if psql == "" {
		return "", &MissingCLIError{CLI: "psql", Hint: "Install PostgreSQL client or run `dbeed install postgres`."}
	}
	db := in.Database
	if db == "" {
		db = in.Name
	}
	user := in.User
	if user == "" {
		user = "postgres"
	}
	args := []string{
		"-h", "127.0.0.1",
		"-p", strconv.Itoa(in.Port),
		"-U", user,
		"-d", db,
		"-At", "-F", "\t",
		"-c", query,
	}
	cmd := exec.Command(psql, args...)
	if in.Password != "" {
		cmd.Env = append(os.Environ(), "PGPASSWORD="+in.Password)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("psql failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func splitTSV(out string) [][]string {
	var rows [][]string
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if line == "" {
			continue
		}
		rows = append(rows, strings.Split(line, "\t"))
	}
	return rows
}

func parsePostgresColumns(out string) map[string]*SchemaTable {
	tables := map[string]*SchemaTable{}
	for _, f := range splitTSV(out) {
		if len(f) < 6 {
			continue
		}
		sch, tbl, col, typ, nullable, def := f[0], f[1], f[2], f[3], f[4], f[5]
		key := sch + "." + tbl
		t, ok := tables[key]
		if !ok {
			t = &SchemaTable{Name: tbl, Schema: sch}
			tables[key] = t
		}
		var defPtr *string
		if def != "" {
			d := def
			defPtr = &d
		}
		t.Columns = append(t.Columns, SchemaColumn{
			Name: col, Type: typ,
			Nullable: nullable == "YES",
			Default:  defPtr,
		})
	}
	return tables
}

func applyPostgresPKs(tables map[string]*SchemaTable, out string) {
	for _, f := range splitTSV(out) {
		if len(f) < 3 {
			continue
		}
		key := f[0] + "." + f[1]
		col := f[2]
		t, ok := tables[key]
		if !ok {
			continue
		}
		for i, c := range t.Columns {
			if c.Name == col {
				t.Columns[i].PK = true
			}
		}
		t.PrimaryKey = append(t.PrimaryKey, col)
	}
}

func parsePostgresRelations(out string) []SchemaRelation {
	var rels []SchemaRelation
	for _, f := range splitTSV(out) {
		if len(f) < 9 {
			continue
		}
		rels = append(rels, SchemaRelation{
			Name: f[0],
			From: SchemaRef{Table: f[2], Column: f[3]},
			To:   SchemaRef{Table: f[5], Column: f[6]},
		})
	}
	return rels
}

func introspectPostgres(in Instance, withCounts bool) (SchemaResponse, error) {
	if in.Status == "stopped" {
		return SchemaResponse{}, fmt.Errorf("instance %q is stopped (start it first)", in.Name)
	}
	db := in.Database
	if db == "" {
		db = in.Name
	}
	colsOut, err := psqlRunner(in, `SELECT table_schema, table_name, column_name, data_type, is_nullable, COALESCE(column_default,'') FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position`)
	if err != nil {
		return SchemaResponse{}, err
	}
	tables := parsePostgresColumns(colsOut)
	pkOut, err := psqlRunner(in, `SELECT tc.table_schema, tc.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.constraint_type='PRIMARY KEY' ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position`)
	if err == nil {
		applyPostgresPKs(tables, pkOut)
	}
	fkOut, err := psqlRunner(in, `SELECT tc.constraint_name, kcu.table_schema, kcu.table_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name, rc.delete_rule, rc.update_rule FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name WHERE tc.constraint_type='FOREIGN KEY' ORDER BY kcu.table_name, kcu.column_name`)
	if err != nil {
		// no FKs is not fatal — treat empty as none
		fkOut = ""
	}
	rels := parsePostgresRelations(fkOut)

	var out []SchemaTable
	for _, t := range tables {
		if withCounts {
			cOut, err := psqlRunner(in, fmt.Sprintf(`SELECT COUNT(*) FROM %s.%s`, quoteIdent(t.Schema), quoteIdent(t.Name)))
			if err == nil {
				if n, perr := strconv.ParseInt(strings.TrimSpace(cOut), 10, 64); perr == nil {
					n := n
					t.RowCount = &n
				}
			}
		}
		out = append(out, *t)
	}
	// stable order
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].Name < out[i].Name {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if out == nil {
		out = []SchemaTable{}
	}
	if rels == nil {
		rels = []SchemaRelation{}
	}
	return SchemaResponse{Database: db, DB: "postgres", Tables: out, Relations: rels}, nil
}

// --- sqlite ---

var sqliteRunner = func(dbFile string, query string) (string, error) {
	bin := lookPath("sqlite3")
	if bin == "" {
		return "", &MissingCLIError{CLI: "sqlite3", Hint: "Install sqlite3 CLI (apt: sqlite3, brew: sqlite)."}
	}
	cmd := exec.Command(bin, "-separator", "\t", dbFile, query)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite3 failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func parseSQLiteTableInfo(table string, out string) SchemaTable {
	t := SchemaTable{Name: table, Schema: "main"}
	for _, f := range splitTSV(out) {
		if len(f) < 6 {
			continue
		}
		// cid|name|type|notnull|dflt_value|pk
		name, typ, notnull, dflt, pk := f[1], f[2], f[3], f[4], f[5]
		var defPtr *string
		if dflt != "" {
			d := dflt
			defPtr = &d
		}
		isPK := pk != "0" && pk != ""
		t.Columns = append(t.Columns, SchemaColumn{
			Name: name, Type: typ,
			Nullable: !isPK && notnull == "0",
			Default:  defPtr,
			PK:       isPK,
		})
		if isPK {
			t.PrimaryKey = append(t.PrimaryKey, name)
		}
	}
	return t
}

func parseSQLiteFKs(table string, out string) []SchemaRelation {
	var rels []SchemaRelation
	for _, f := range splitTSV(out) {
		if len(f) < 8 {
			continue
		}
		// id|seq|table|from|to|on_update|on_delete|match
		toTable, fromCol, toCol := f[2], f[3], f[4]
		rels = append(rels, SchemaRelation{
			Name: fmt.Sprintf("fk_%s_%s", table, fromCol),
			From: SchemaRef{Table: table, Column: fromCol},
			To:   SchemaRef{Table: toTable, Column: toCol},
		})
	}
	return rels
}

func introspectSQLite(in Instance, withCounts bool) (SchemaResponse, error) {
	dbFile := filepath.Join(in.DataDir, "db.sqlite")
	if _, err := os.Stat(dbFile); err != nil {
		return SchemaResponse{}, fmt.Errorf("sqlite file not found: %s", dbFile)
	}
	listOut, err := sqliteRunner(dbFile, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`)
	if err != nil {
		return SchemaResponse{}, err
	}
	var names []string
	for _, line := range strings.Split(strings.TrimSpace(listOut), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			names = append(names, line)
		}
	}
	var tables []SchemaTable
	var rels []SchemaRelation
	for _, tbl := range names {
		infoOut, err := sqliteRunner(dbFile, fmt.Sprintf(`PRAGMA table_info(%s);`, quoteIdent(tbl)))
		if err != nil {
			continue
		}
		t := parseSQLiteTableInfo(tbl, infoOut)
		if withCounts {
			if cOut, err := sqliteRunner(dbFile, fmt.Sprintf(`SELECT COUNT(*) FROM %s;`, quoteIdent(tbl))); err == nil {
				if n, perr := strconv.ParseInt(strings.TrimSpace(cOut), 10, 64); perr == nil {
					n := n
					t.RowCount = &n
				}
			}
		}
		tables = append(tables, t)
		fkOut, err := sqliteRunner(dbFile, fmt.Sprintf(`PRAGMA foreign_key_list(%s);`, quoteIdent(tbl)))
		if err == nil && strings.TrimSpace(fkOut) != "" {
			rels = append(rels, parseSQLiteFKs(tbl, fkOut)...)
		}
	}
	if tables == nil {
		tables = []SchemaTable{}
	}
	if rels == nil {
		rels = []SchemaRelation{}
	}
	return SchemaResponse{Database: in.Name, DB: "sqlite", Tables: tables, Relations: rels}, nil
}
