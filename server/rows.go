package server

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// NullMarker is emitted by psql/sqlite CLIs for SQL NULL and mapped back to nil.
const NullMarker = "__DBEED_NULL__"

type RowsResponse struct {
	Table   string   `json:"table"`
	Schema  string   `json:"schema"`
	Columns []string `json:"columns"`
	// Rows uses nil for SQL NULL so the TUI can render it distinctly.
	Rows   [][]*string `json:"rows"`
	Total  int64       `json:"total"`
	Limit  int         `json:"limit"`
	Offset int         `json:"offset"`
}

func clampRowsPage(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// QueryRows returns a page of table data. Table names are validated against
// the live schema so arbitrary SQL cannot be injected via the table param.
func QueryRows(in Instance, table string, limit, offset int) (RowsResponse, error) {
	limit, offset = clampRowsPage(limit, offset)
	if table == "" {
		return RowsResponse{}, fmt.Errorf("table required")
	}
	switch in.DB {
	case "postgres":
		return queryPostgresRows(in, table, limit, offset)
	case "sqlite":
		return querySQLiteRows(in, table, limit, offset)
	default:
		return RowsResponse{}, fmt.Errorf("rows query unsupported for db %q", in.DB)
	}
}

func findSchemaTable(in Instance, table string) (SchemaTable, error) {
	schema, err := IntrospectSchema(in, false)
	if err != nil {
		return SchemaTable{}, err
	}
	for _, t := range schema.Tables {
		if t.Name == table {
			return t, nil
		}
	}
	return SchemaTable{}, fmt.Errorf("table %q not found", table)
}

var psqlRowsRunner = func(in Instance, query string) (string, error) {
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
		"-P", "null=" + NullMarker,
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

var sqliteRowsRunner = func(dbFile string, query string) (string, error) {
	bin := lookPath("sqlite3")
	if bin == "" {
		return "", &MissingCLIError{CLI: "sqlite3", Hint: "Install sqlite3 CLI (apt: sqlite3, brew: sqlite)."}
	}
	cmd := exec.Command(bin, "-separator", "\t", "-nullvalue", NullMarker, dbFile, query)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite3 failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func sqliteFile(in Instance) (string, error) {
	dbFile := filepath.Join(in.DataDir, "db.sqlite")
	if _, err := os.Stat(dbFile); err != nil {
		return "", fmt.Errorf("sqlite file not found: %s", dbFile)
	}
	return dbFile, nil
}

func parseRowsTSV(out string, ncols int) [][]*string {
	var rows [][]*string
	trimmed := strings.TrimRight(out, "\n")
	if trimmed == "" {
		return [][]*string{}
	}
	for _, line := range strings.Split(trimmed, "\n") {
		fields := strings.Split(line, "\t")
		// pad/truncate to column count so ragged output stays aligned
		for len(fields) < ncols {
			fields = append(fields, "")
		}
		if len(fields) > ncols {
			fields = fields[:ncols]
		}
		row := make([]*string, ncols)
		for i, f := range fields {
			if f == NullMarker {
				row[i] = nil
			} else {
				v := f
				row[i] = &v
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func columnNames(t SchemaTable) []string {
	cols := make([]string, 0, len(t.Columns))
	for _, c := range t.Columns {
		cols = append(cols, c.Name)
	}
	return cols
}

func queryPostgresRows(in Instance, table string, limit, offset int) (RowsResponse, error) {
	t, err := findSchemaTable(in, table)
	if err != nil {
		return RowsResponse{}, err
	}
	cols := columnNames(t)
	if len(cols) == 0 {
		return RowsResponse{Table: t.Name, Schema: t.Schema, Columns: []string{}, Rows: [][]*string{}, Total: 0, Limit: limit, Offset: offset}, nil
	}
	quoted := make([]string, 0, len(cols))
	for _, c := range cols {
		quoted = append(quoted, quoteIdent(c))
	}
	countOut, err := psqlRunner(in, fmt.Sprintf(`SELECT COUNT(*) FROM %s.%s`, quoteIdent(t.Schema), quoteIdent(t.Name)))
	if err != nil {
		return RowsResponse{}, err
	}
	total, _ := strconv.ParseInt(strings.TrimSpace(countOut), 10, 64)
	dataOut, err := psqlRowsRunner(in, fmt.Sprintf(`SELECT %s FROM %s.%s ORDER BY 1 LIMIT %d OFFSET %d`, strings.Join(quoted, ", "), quoteIdent(t.Schema), quoteIdent(t.Name), limit, offset))
	if err != nil {
		return RowsResponse{}, err
	}
	rows := parseRowsTSV(dataOut, len(cols))
	if rows == nil {
		rows = [][]*string{}
	}
	return RowsResponse{Table: t.Name, Schema: t.Schema, Columns: cols, Rows: rows, Total: total, Limit: limit, Offset: offset}, nil
}

func querySQLiteRows(in Instance, table string, limit, offset int) (RowsResponse, error) {
	t, err := findSchemaTable(in, table)
	if err != nil {
		return RowsResponse{}, err
	}
	dbFile, err := sqliteFile(in)
	if err != nil {
		return RowsResponse{}, err
	}
	cols := columnNames(t)
	if len(cols) == 0 {
		return RowsResponse{Table: t.Name, Schema: t.Schema, Columns: []string{}, Rows: [][]*string{}, Total: 0, Limit: limit, Offset: offset}, nil
	}
	quoted := make([]string, 0, len(cols))
	for _, c := range cols {
		quoted = append(quoted, quoteIdent(c))
	}
	countOut, err := sqliteRunner(dbFile, fmt.Sprintf(`SELECT COUNT(*) FROM %s;`, quoteIdent(t.Name)))
	if err != nil {
		return RowsResponse{}, err
	}
	total, _ := strconv.ParseInt(strings.TrimSpace(countOut), 10, 64)
	dataOut, err := sqliteRowsRunner(dbFile, fmt.Sprintf(`SELECT %s FROM %s ORDER BY 1 LIMIT %d OFFSET %d;`, strings.Join(quoted, ", "), quoteIdent(t.Name), limit, offset))
	if err != nil {
		return RowsResponse{}, err
	}
	rows := parseRowsTSV(dataOut, len(cols))
	if rows == nil {
		rows = [][]*string{}
	}
	return RowsResponse{Table: t.Name, Schema: t.Schema, Columns: cols, Rows: rows, Total: total, Limit: limit, Offset: offset}, nil
}
