package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFakePgBin(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func fakePgEnv(t *testing.T) string {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("provision refuses root (initdb)")
	}
	dir := t.TempDir()
	t.Setenv("DBEED_DATA_DIR", t.TempDir())
	// isolate PATH to fakes + basic tools (mkdir/sh live in /bin)
	writeFakePgBin(t, dir, "initdb", `echo "$@" > "$CAPTURE/initdb.args"`+"\n"+`mkdir -p "$2"`)
	writeFakePgBin(t, dir, "psql", `exit 0`)
	t.Setenv("PATH", dir+":/usr/bin:/bin")
	t.Setenv("CAPTURE", dir)
	return dir
}

func TestProvisionPostgresNativeUsesInstanceSocketDir(t *testing.T) {
	dir := fakePgEnv(t)
	writeFakePgBin(t, dir, "pg_ctl", `echo "$@" > "$CAPTURE/pgctl.args"`+"\n"+`exit 0`)
	writeFakePgBin(t, dir, "postgres", `exit 0`)

	st, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	in, err := provisionPostgresNative(st, "pgtest", 0, "postgres", "postgres", "pgtest")
	if err != nil {
		t.Fatalf("provision failed: %v", err)
	}
	args, _ := os.ReadFile(filepath.Join(dir, "pgctl.args"))
	if !strings.Contains(string(args), "-k "+in.DataDir) {
		t.Fatalf("pg_ctl missing instance socket dir, got: %s", string(args))
	}
	if !strings.HasPrefix(in.Connection, "postgres://") {
		t.Fatalf("bad connection string: %s", in.Connection)
	}
}

func TestProvisionPostgresNativeFailureShowsLogTailAndCleansUp(t *testing.T) {
	dir := fakePgEnv(t)
	writeFakePgBin(t, dir, "pg_ctl", `echo "$@" > "$CAPTURE/pgctl.args"`+"\n"+
		`log=""; prev=""; for a in "$@"; do if [ "$prev" = "-l" ]; then log="$a"; fi; prev="$a"; done`+"\n"+
		`echo "FATAL: could not create socket" > "$log"`+"\n"+`exit 1`)
	writeFakePgBin(t, dir, "postgres", `exit 0`)

	st, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	_, err = provisionPostgresNative(st, "pgfail", 0, "postgres", "postgres", "pgfail")
	if err == nil {
		t.Fatal("expected provision error")
	}
	if !strings.Contains(err.Error(), "FATAL: could not create socket") {
		t.Fatalf("error missing log tail: %v", err)
	}
	if _, statErr := os.Stat(DataDir("pgfail")); !os.IsNotExist(statErr) {
		t.Fatal("failed provision left data dir behind")
	}
}
