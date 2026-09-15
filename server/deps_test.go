package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFakeBin(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresDepInstalled(t *testing.T) {
	dir := t.TempDir()
	for _, b := range pgRequiredBins {
		writeFakeBin(t, dir, b)
	}
	t.Setenv("PATH", dir)
	t.Setenv("DBEED_DATA_DIR", t.TempDir())
	dep := PostgresDep()
	if !dep.Installed {
		t.Fatalf("expected installed, got %+v", dep)
	}
	for _, b := range pgRequiredBins {
		if dep.Binaries[b] == "" {
			t.Fatalf("missing binary path for %s: %+v", b, dep)
		}
	}
}

func TestPostgresDepMissingReportsManager(t *testing.T) {
	dir := t.TempDir()
	writeFakeBin(t, dir, "apt-get")
	t.Setenv("PATH", dir)
	t.Setenv("DBEED_DATA_DIR", t.TempDir())
	dep := PostgresDep()
	if dep.Installed {
		t.Fatalf("expected not installed, got %+v", dep)
	}
	if dep.Manager != "apt-get" {
		t.Fatalf("expected manager apt-get, got %+v", dep)
	}
	if dep.Package != "postgresql" {
		t.Fatalf("expected package postgresql, got %+v", dep)
	}
	if !strings.Contains(dep.InstallCommand, "apt-get install -y postgresql") {
		t.Fatalf("unexpected install command: %q", dep.InstallCommand)
	}
}

func TestPostgresDepReportsUninstallCommand(t *testing.T) {
	dir := t.TempDir()
	writeFakeBin(t, dir, "apt-get")
	t.Setenv("PATH", dir)
	t.Setenv("DBEED_DATA_DIR", t.TempDir())

	// missing binaries: both commands reported
	missing := PostgresDep()
	if missing.Installed {
		t.Fatalf("expected not installed, got %+v", missing)
	}
	if !strings.Contains(missing.UninstallCommand, "apt-get remove -y postgresql") {
		t.Fatalf("unexpected uninstall command: %q", missing.UninstallCommand)
	}

	// installed binaries: uninstall command still reported
	for _, b := range pgRequiredBins {
		writeFakeBin(t, dir, b)
	}
	present := PostgresDep()
	if !present.Installed {
		t.Fatalf("expected installed, got %+v", present)
	}
	if !strings.Contains(present.UninstallCommand, "apt-get remove -y postgresql") {
		t.Fatalf("unexpected uninstall command: %q", present.UninstallCommand)
	}
}

func TestMissingBinariesErrorMentionsDocker(t *testing.T) {	err := &MissingBinariesError{Dep: DepStatus{Hint: "x"}}
	if !strings.Contains(err.Error(), "--engine docker") {
		t.Fatalf("error should mention docker fallback: %q", err.Error())
	}
}
