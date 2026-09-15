package server

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// --- helpers ---

func freePort(start int) (int, error) {
	for p := start; p < start+100; p++ {
		l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err == nil {
			_ = l.Close()
			return p, nil
		}
	}
	return 0, fmt.Errorf("no free port near %d", start)
}

func lookPath(names ...string) string {
	// also check well-known postgres locations (Debian/RHEL/Homebrew)
	// and dbeed's own bin dir
	extra := pgExtraDirs()
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
		for _, d := range extra {
			cand := filepath.Join(d, n)
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand
			}
		}
	}
	return ""
}

func portOpen(port int) bool {
	c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 500_000_000)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

func dockerAvailable() bool { return lookPath("docker") != "" }

// quoteOpt quotes a path for pg_ctl's -o option string when needed.
func quoteOpt(s string) string {
	if strings.ContainsAny(s, " \t\"'") {
		return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
	}
	return s
}

// tailFile returns the last n bytes of a file (for error diagnostics).
func tailFile(path string, n int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return "(no log file)"
	}
	if len(data) > n {
		data = data[len(data)-n:]
	}
	return string(data)
}

// --- sqlite native ---

func provisionSQLite(st *Store, name string) (Instance, error) {
	in := Instance{
		ID: name, Name: name, DB: "sqlite", Engine: "native",
		Status: "running", DataDir: DataDir(name), CreatedAt: now(),
	}
	if err := os.MkdirAll(in.DataDir, 0o755); err != nil {
		return Instance{}, err
	}
	f := filepath.Join(in.DataDir, "db.sqlite")
	if _, err := os.Stat(f); os.IsNotExist(err) {
		if err := os.WriteFile(f, []byte{}, 0o644); err != nil {
			return Instance{}, err
		}
	}
	in.Connection = ConnectionString(in)
	if err := st.Upsert(in); err != nil {
		return Instance{}, err
	}
	return in, nil
}

// --- postgres native ---

func provisionPostgresNative(st *Store, name string, port int, user, password, database string) (Instance, error) {
	dep := PostgresDep()
	if !dep.Installed {
		return Instance{}, &MissingBinariesError{Dep: dep}
	}
	if os.Geteuid() == 0 {
		return Instance{}, fmt.Errorf("dbeed-server runs as root; initdb refuses to run as root. Run as a normal user or use --engine docker")
	}
	initdb := lookPath("initdb")
	pgCtl := lookPath("pg_ctl")
	postgres := lookPath("postgres")
	if initdb == "" || pgCtl == "" || postgres == "" {
		return Instance{}, &MissingBinariesError{Dep: dep}
	}
	if port == 0 {
		port = 5432
	}
	p, err := freePort(port)
	if err != nil {
		return Instance{}, err
	}
	port = p
	dataDir := DataDir(name)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return Instance{}, err
	}
	fail := func(err error) (Instance, error) {
		// leave no half-provisioned dir behind so a retry starts clean
		_ = os.RemoveAll(dataDir)
		return Instance{}, err
	}
	logFile := filepath.Join(dataDir, "server.log")
	// Sockets go inside the instance dir: the default /var/run/postgresql
	// is usually not writable by a normal user and pg_ctl would fail.
	pgOpts := fmt.Sprintf("-p %d -k %s", port, quoteOpt(dataDir))
	// initdb
	cmd := exec.Command(initdb, "-D", dataDir, "-U", user, "--auth=trust")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fail(fmt.Errorf("initdb failed: %v: %s", err, string(out)))
	}
	// start
	args := []string{"-D", dataDir, "-l", logFile, "-o", pgOpts, "start"}
	if out, err := exec.Command(pgCtl, args...).CombinedOutput(); err != nil {
		return fail(fmt.Errorf("pg_ctl start failed: %v: %s\n-- server.log tail --\n%s", err, string(out), tailFile(logFile, 3000)))
	}
	// create database + password (best effort)
	_ = exec.Command(lookPath("psql"), "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-U", user, "-d", "postgres", "-c", fmt.Sprintf(`CREATE DATABASE "%s"`, database)).Run()
	in := Instance{
		ID: name, Name: name, DB: "postgres", Engine: "native",
		Status: "running", Port: port, User: user, Password: password,
		Database: database, DataDir: dataDir, CreatedAt: now(), LogFile: logFile,
	}
	in.Connection = ConnectionString(in)
	if err := st.Upsert(in); err != nil {
		return Instance{}, err
	}
	return in, nil
}

func stopPostgresNative(in Instance) error {
	pgCtl := lookPath("pg_ctl")
	if pgCtl == "" {
		return fmt.Errorf("pg_ctl not found")
	}
	_ = exec.Command(pgCtl, "-D", in.DataDir, "stop", "-m", "fast").Run()
	return nil
}

func startPostgresNative(in Instance) error {
	pgCtl := lookPath("pg_ctl")
	if pgCtl == "" {
		return fmt.Errorf("pg_ctl not found")
	}
	if in.Port == 0 {
		in.Port = 5432
	}
	p, _ := freePort(in.Port)
	args := []string{"-D", in.DataDir, "-l", in.LogFile, "-o", fmt.Sprintf("-p %d -k %s", p, quoteOpt(in.DataDir)), "start"}
	if out, err := exec.Command(pgCtl, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("pg_ctl start failed: %v: %s\n-- server.log tail --\n%s", err, string(out), tailFile(in.LogFile, 3000))
	}
	return nil
}

// --- postgres docker ---

func dockerName(name string) string { return "dbeed-" + name }

func provisionPostgresDocker(st *Store, name string, port int, user, password, database string) (Instance, error) {
	if !dockerAvailable() {
		return Instance{}, fmt.Errorf("docker not found on PATH")
	}
	if port == 0 {
		port = 5432
	}
	p, err := freePort(port)
	if err != nil {
		return Instance{}, err
	}
	port = p
	dataDir := DataDir(name)
	_ = os.MkdirAll(dataDir, 0o755)
	logFile := filepath.Join(dataDir, "docker.log")
	args := []string{"run", "-d", "--name", dockerName(name),
		"-p", fmt.Sprintf("%d:5432", port),
		"-e", "POSTGRES_USER=" + user,
		"-e", "POSTGRES_PASSWORD=" + password,
		"-e", "POSTGRES_DB=" + database,
		"postgres:16"}
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return Instance{}, fmt.Errorf("docker run failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	in := Instance{
		ID: name, Name: name, DB: "postgres", Engine: "docker",
		Status: "running", Port: port, User: user, Password: password,
		Database: database, DataDir: dataDir, CreatedAt: now(),
		Container: strings.TrimSpace(string(out)), LogFile: logFile,
	}
	in.Connection = ConnectionString(in)
	if err := st.Upsert(in); err != nil {
		return Instance{}, err
	}
	return in, nil
}

func dockerExec(name string, args ...string) (string, error) {
	out, err := exec.Command("docker", append([]string{name}, args...)...).CombinedOutput()
	return string(out), err
}
