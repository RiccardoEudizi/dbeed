package server

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// QueryNullMarker is the sentinel used to round-trip SQL NULL through the
// psql CSV output.
const QueryNullMarker = "__DBEED_NULL__"

const (
	defaultQueryLimit = 200
	maxQueryLimit     = 1000
)

type QueryRequest struct {
	SQL   string `json:"sql"`
	Limit int    `json:"limit"`
}

type QueryResponse struct {
	Columns    []string    `json:"columns"`
	Rows       [][]*string `json:"rows"`
	RowCount   int         `json:"rowCount"`
	Command    string      `json:"command,omitempty"`
	Truncated  bool        `json:"truncated"`
	DurationMs int64       `json:"durationMs"`
}

func clampQueryLimit(limit int) int {
	if limit <= 0 {
		return defaultQueryLimit
	}
	if limit > maxQueryLimit {
		return maxQueryLimit
	}
	return limit
}

type statementKind int

const (
	statementRows statementKind = iota
	statementRowsNoWrap
	statementCommand
)

// classifyStatement decides how a statement is executed. Only statements that
// are guaranteed to return rows get wrapped in a LIMIT subquery; EXPLAIN,
// SHOW and PRAGMA return rows but are not valid subqueries on every engine.
func classifyStatement(stmt string) statementKind {
	switch firstSQLKeyword(stmt) {
	case "select", "with", "values", "table":
		return statementRows
	case "show", "explain", "pragma":
		return statementRowsNoWrap
	default:
		return statementCommand
	}
}

func firstSQLKeyword(stmt string) string {
	s := stripLeadingSQLComments(stmt)
	end := 0
	for end < len(s) && (isIdentByte(s[end])) {
		end++
	}
	return strings.ToLower(s[:end])
}

func isIdentByte(b byte) bool {
	return b == '_' || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

func stripLeadingSQLComments(s string) string {
	for {
		s = strings.TrimSpace(s)
		switch {
		case strings.HasPrefix(s, "--"):
			i := strings.IndexByte(s, '\n')
			if i < 0 {
				return ""
			}
			s = s[i+1:]
		case strings.HasPrefix(s, "/*"):
			i := strings.Index(s, "*/")
			if i < 0 {
				return ""
			}
			s = s[i+2:]
		default:
			return s
		}
	}
}

// normalizeStatement trims whitespace and trailing semicolons so the statement
// can be safely embedded in a wrapping subquery.
func normalizeStatement(sql string) string {
	s := strings.TrimSpace(sql)
	for strings.HasSuffix(s, ";") {
		s = strings.TrimSpace(strings.TrimSuffix(s, ";"))
	}
	return s
}

// RunQuery executes one arbitrary SQL statement against a managed instance.
// Row-returning statements are capped at limit rows (max 1000); other
// statements report their command tag.
func RunQuery(in Instance, sql string, limit int) (QueryResponse, error) {
	limit = clampQueryLimit(limit)
	stmt := normalizeStatement(sql)
	if stmt == "" {
		return QueryResponse{}, fmt.Errorf("sql required")
	}
	start := time.Now()
	var res QueryResponse
	var err error
	switch in.DB {
	case "postgres":
		res, err = queryPostgres(in, stmt, limit)
	case "sqlite":
		res, err = querySQLite(in, stmt, limit)
	default:
		return QueryResponse{}, fmt.Errorf("query unsupported for db %q", in.DB)
	}
	if err != nil {
		return QueryResponse{}, err
	}
	res.DurationMs = time.Since(start).Milliseconds()
	if res.Columns == nil {
		res.Columns = []string{}
	}
	if res.Rows == nil {
		res.Rows = [][]*string{}
	}
	res.RowCount = len(res.Rows)
	return res, nil
}

// --- postgres ---

// psqlExec runs a query with the instance credentials. csvOutput enables
// psql's --csv mode (used for statements that are not wrapped in COPY).
var psqlExec = func(in Instance, query string, csvOutput bool) (string, error) {
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
		"-X",
		"-v", "ON_ERROR_STOP=1",
		"-h", "127.0.0.1",
		"-p", strconv.Itoa(in.Port),
		"-U", user,
		"-d", db,
	}
	if csvOutput {
		args = append(args, "--csv", "-P", "null="+QueryNullMarker)
	} else {
		args = append(args, "-A", "-t")
	}
	args = append(args, "-c", query)
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

func queryPostgres(in Instance, stmt string, limit int) (QueryResponse, error) {
	stmt = normalizeStatement(stmt)
	kind := classifyStatement(stmt)
	if kind == statementCommand {
		out, err := psqlExec(in, stmt, true)
		if err != nil {
			return QueryResponse{}, err
		}
		return parsePSQLCSV(out, limit)
	}
	if kind == statementRows {
		query := fmt.Sprintf(
			"COPY (SELECT * FROM (%s) AS _dbeed_q LIMIT %d) TO STDOUT WITH (FORMAT csv, HEADER true, NULL '%s')",
			stmt, limit+1, QueryNullMarker,
		)
		out, err := psqlExec(in, query, false)
		if err != nil {
			return QueryResponse{}, err
		}
		return parsePSQLCSV(out, limit)
	}
	out, err := psqlExec(in, stmt, true)
	if err != nil {
		return QueryResponse{}, err
	}
	return parsePSQLCSV(out, limit)
}

var commandTagRe = regexp.MustCompile(`^(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COMMENT|VACUUM|ANALYZE|SET|RESET|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|COPY|DO|CALL|LISTEN|UNLISTEN|NOTIFY|CLUSTER|REINDEX|REFRESH|DISCARD|CHECKPOINT|LOCK|PREPARE|EXECUTE|DEALLOCATE|START|END|ABORT)\b`)

func parsePSQLCSV(out string, limit int) (QueryResponse, error) {
	records, err := readCSV(out)
	if err != nil {
		return QueryResponse{}, err
	}
	if len(records) == 0 {
		return QueryResponse{Columns: []string{}, Rows: [][]*string{}}, nil
	}
	// A non-row statement prints a single command tag, e.g. "UPDATE 2".
	if len(records) == 1 && len(records[0]) == 1 && commandTagRe.MatchString(records[0][0]) {
		return QueryResponse{Command: records[0][0]}, nil
	}
	return rowsFromRecords(records, limit), nil
}

func readCSV(out string) ([][]string, error) {
	r := csv.NewReader(strings.NewReader(out))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse output: %w", err)
	}
	return records, nil
}

func rowsFromRecords(records [][]string, limit int) QueryResponse {
	columns := records[0]
	rows := make([][]*string, 0, len(records)-1)
	for _, rec := range records[1:] {
		row := make([]*string, len(columns))
		for i := range columns {
			if i >= len(rec) || rec[i] == QueryNullMarker {
				row[i] = nil
				continue
			}
			v := rec[i]
			row[i] = &v
		}
		rows = append(rows, row)
	}
	truncated := len(rows) > limit
	if truncated {
		rows = rows[:limit]
	}
	return QueryResponse{Columns: columns, Rows: rows, RowCount: len(rows), Truncated: truncated}
}

// --- sqlite ---

// sqliteExec runs a query against the instance's database file. jsonOutput
// enables sqlite3's -json mode, which preserves NULLs.
var sqliteExec = func(dbFile, query string, jsonOutput bool) (string, error) {
	bin := lookPath("sqlite3")
	if bin == "" {
		return "", &MissingCLIError{CLI: "sqlite3", Hint: "Install sqlite3 CLI (apt: sqlite3, brew: sqlite)."}
	}
	args := []string{}
	if jsonOutput {
		args = append(args, "-json")
	}
	args = append(args, dbFile, query)
	cmd := exec.Command(bin, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite3 failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func querySQLite(in Instance, stmt string, limit int) (QueryResponse, error) {
	dbFile, err := sqliteFile(in)
	if err != nil {
		return QueryResponse{}, err
	}
	stmt = normalizeStatement(stmt)
	kind := classifyStatement(stmt)
	if kind == statementCommand {
		if _, err := sqliteExec(dbFile, stmt, false); err != nil {
			return QueryResponse{}, err
		}
		return QueryResponse{Command: "ok"}, nil
	}
	query := stmt
	if kind == statementRows {
		query = fmt.Sprintf("SELECT * FROM (%s) LIMIT %d", stmt, limit+1)
	}
	out, err := sqliteExec(dbFile, query, true)
	if err != nil {
		return QueryResponse{}, err
	}
	columns, rows, err := parseSQLiteJSON(out)
	if err != nil {
		return QueryResponse{}, err
	}
	truncated := len(rows) > limit
	if truncated {
		rows = rows[:limit]
	}
	return QueryResponse{Columns: columns, Rows: rows, Truncated: truncated}, nil
}

// parseSQLiteJSON decodes sqlite3 -json output while preserving column order
// and duplicate column names. An empty result yields no columns: sqlite3 omits
// the header entirely when a query returns no rows.
func parseSQLiteJSON(out string) ([]string, [][]*string, error) {
	out = strings.TrimSpace(out)
	if out == "" {
		return []string{}, [][]*string{}, nil
	}
	dec := json.NewDecoder(strings.NewReader(out))
	dec.UseNumber()
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return nil, nil, fmt.Errorf("parse sqlite output: expected array")
	}
	columns := []string{}
	rows := [][]*string{}
	for dec.More() {
		if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
			return nil, nil, fmt.Errorf("parse sqlite output: expected object")
		}
		row := []*string{}
		for dec.More() {
			tok, err := dec.Token()
			if err != nil {
				return nil, nil, err
			}
			key, ok := tok.(string)
			if !ok {
				return nil, nil, fmt.Errorf("parse sqlite output: bad key")
			}
			var value any
			if err := dec.Decode(&value); err != nil {
				return nil, nil, err
			}
			if len(rows) == 0 {
				columns = append(columns, key)
			}
			row = append(row, jsonValue(value))
		}
		if _, err := dec.Token(); err != nil { // closing '}'
			return nil, nil, err
		}
		rows = append(rows, row)
	}
	return columns, rows, nil
}

func jsonValue(v any) *string {
	switch val := v.(type) {
	case nil:
		return nil
	case string:
		return &val
	case json.Number:
		s := val.String()
		return &s
	case bool:
		s := "false"
		if val {
			s = "true"
		}
		return &s
	default:
		data, err := json.Marshal(val)
		if err != nil {
			return nil
		}
		s := string(data)
		return &s
	}
}
