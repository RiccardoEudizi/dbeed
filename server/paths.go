package server

import (
	"os"
	"path/filepath"
)

// Paths returns base data dir, state file, server discovery file.
func BaseDir() string {
	if v := os.Getenv("DBEED_DATA_DIR"); v != "" {
		return v
	}
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "dbeed")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "dbeed")
	}
	return filepath.Join(home, ".local", "share", "dbeed")
}

func StateFile() string          { return filepath.Join(BaseDir(), "state.json") }
func ServerFile() string         { return filepath.Join(BaseDir(), "server.json") }
func DataDir(name string) string { return filepath.Join(BaseDir(), "data", name) }
func BinDir() string             { return filepath.Join(BaseDir(), "bin") }

func EnsureBase() error {
	for _, d := range []string{BaseDir(), filepath.Join(BaseDir(), "data"), BinDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}
