package server

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// DepStatus describes whether postgres system binaries are available and,
// if not, how to install them with the system package manager.
type DepStatus struct {
	Installed      bool              `json:"installed"`
	Binaries       map[string]string `json:"binaries,omitempty"`
	Manager        string            `json:"manager,omitempty"`
	Package        string            `json:"package,omitempty"`
	InstallCommand string            `json:"installCommand,omitempty"`
	Hint           string            `json:"hint,omitempty"`
}

// MissingBinariesError is returned when postgres native provisioning is
// requested but no system binaries exist. The client uses Dep to offer an
// assisted system install (or docker fallback).
type MissingBinariesError struct{ Dep DepStatus }

func (e *MissingBinariesError) Error() string {
	if e.Dep.InstallCommand != "" {
		return fmt.Sprintf("postgres binaries not found. Run `dbeed install postgres` to download and install them (via: %s), or retry with --engine docker", e.Dep.InstallCommand)
	}
	return "postgres binaries not found and no supported package manager was detected. Install PostgreSQL manually or retry with --engine docker"
}

var pgRequiredBins = []string{"initdb", "pg_ctl", "postgres"}

// pgExtraDirs lists well-known install locations outside PATH:
// Debian/Ubuntu versioned lib dir, RHEL versioned dir, Homebrew prefixes,
// plus dbeed's own dir (reserved for future use).
func pgExtraDirs() []string {
	dirs := []string{filepath.Join(BinDir(), "pg16", "bin")}
	for _, pattern := range []string{
		"/usr/lib/postgresql/*/bin",
		"/usr/pgsql-*/bin",
		"/opt/homebrew/opt/postgresql*/bin",
		"/usr/local/opt/postgresql*/bin",
	} {
		matches, _ := filepath.Glob(pattern)
		dirs = append(dirs, matches...)
	}
	return dirs
}

func findPgBin(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, d := range pgExtraDirs() {
		cand := filepath.Join(d, name)
		if st, err := os.Stat(cand); err == nil && !st.IsDir() {
			return cand
		}
	}
	return ""
}

type pgManagerDef struct {
	bin     string // package manager binary
	pkg     string // postgres package name
	install string // install command template, %s = sudo prefix ("" or "sudo ")
}

func detectPgManager() (pgManagerDef, bool) {
	if runtime.GOOS == "darwin" {
		if _, err := exec.LookPath("brew"); err == nil {
			return pgManagerDef{bin: "brew", pkg: "postgresql", install: "brew install postgresql"}, true
		}
		return pgManagerDef{}, false
	}
	candidates := []pgManagerDef{
		{bin: "apt-get", pkg: "postgresql", install: "%sapt-get update && %sapt-get install -y postgresql"},
		{bin: "dnf", pkg: "postgresql-server", install: "%sdnf install -y postgresql-server"},
		{bin: "yum", pkg: "postgresql-server", install: "%syum install -y postgresql-server"},
		{bin: "pacman", pkg: "postgresql", install: "%spacman -S --noconfirm postgresql"},
		{bin: "apk", pkg: "postgresql", install: "%sapk add postgresql"},
		{bin: "zypper", pkg: "postgresql-server", install: "%szypper install -y postgresql-server"},
	}
	for _, c := range candidates {
		if _, err := exec.LookPath(c.bin); err == nil {
			return c, true
		}
	}
	return pgManagerDef{}, false
}

func sudoPrefix() string {
	if os.Geteuid() == 0 {
		return ""
	}
	if _, err := exec.LookPath("sudo"); err == nil {
		return "sudo "
	}
	return ""
}

// PostgresDep checks for real postgres binaries on this machine.
func PostgresDep() DepStatus {
	bins := map[string]string{}
	missing := []string{}
	for _, b := range pgRequiredBins {
		if p := findPgBin(b); p != "" {
			bins[b] = p
		} else {
			missing = append(missing, b)
		}
	}
	if len(missing) == 0 {
		return DepStatus{Installed: true, Binaries: bins}
	}
	dep := DepStatus{Installed: false}
	mgr, ok := detectPgManager()
	if !ok {
		dep.Hint = fmt.Sprintf("missing binaries (%s); no supported package manager found (apt-get/dnf/pacman/apk/zypper/brew). Install PostgreSQL manually or use --engine docker", strings.Join(missing, ", "))
		return dep
	}
	prefix := sudoPrefix()
	dep.Manager = mgr.bin
	dep.Package = mgr.pkg
	dep.InstallCommand = strings.ReplaceAll(mgr.install, "%s", prefix)
	if prefix == "" && os.Geteuid() != 0 {
		dep.Hint = fmt.Sprintf("missing binaries (%s); no sudo found and not running as root — install the %q package manually or use --engine docker", strings.Join(missing, ", "), mgr.pkg)
	}
	return dep
}

// DockerDep reports docker CLI availability (fallback engine).
func DockerDep() map[string]any {
	if p, err := exec.LookPath("docker"); err == nil {
		return map[string]any{"installed": true, "path": p}
	}
	return map[string]any{"installed": false, "hint": "install Docker Desktop / docker engine, or use --engine native with system postgres"}
}
