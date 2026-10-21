package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type CreateRequest struct {
	DB       string `json:"db"`
	Engine   string `json:"engine"`
	Name     string `json:"name"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
}

type API struct {
	store *Store
	token string
	mux   *http.ServeMux
}

func NewAPI(store *Store, token string) *API {
	a := &API{store: store, token: token, mux: http.NewServeMux()}
	a.routes()
	return a
}

func (a *API) Handler() http.Handler { return a.mux }

func (a *API) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next(w, r)
			return
		}
		if a.token != "" && r.Header.Get("X-Dbeed-Token") != a.token {
			writeErr(w, 401, "unauthorized")
			return
		}
		next(w, r)
	}
}

func (a *API) routes() {
	a.mux.HandleFunc("/healthz", a.auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}))
	a.mux.HandleFunc("/api/instances", a.auth(a.handleInstances))
	a.mux.HandleFunc("/api/instances/", a.auth(a.handleInstance))
	a.mux.HandleFunc("/api/deps", a.auth(a.handleDeps))
	a.mux.HandleFunc("/api/shutdown", a.auth(a.handleShutdown))
	a.mux.HandleFunc("/events", a.auth(a.handleEvents))
}

func (a *API) handleInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		list, err := a.store.List()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		// refresh running status
		for i, in := range list {
			list[i].Status = liveStatus(in)
		}
		writeJSON(w, 200, list)
	case "POST":
		var req CreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, "invalid json")
			return
		}
		in, err := a.create(req)
		if err != nil {
			var mbe *MissingBinariesError
			if errors.As(err, &mbe) {
				writeJSON(w, 500, map[string]any{
					"error":          mbe.Error(),
					"code":           "postgres_binaries_missing",
					"installCommand": mbe.Dep.InstallCommand,
					"manager":        mbe.Dep.Manager,
					"package":        mbe.Dep.Package,
					"hint":           mbe.Dep.Hint,
				})
				return
			}
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 201, in)
	default:
		writeErr(w, 405, "method not allowed")
	}
}

func (a *API) create(req CreateRequest) (Instance, error) {
	if req.Name == "" {
		return Instance{}, fmt.Errorf("name required")
	}
	if req.DB == "" {
		return Instance{}, fmt.Errorf("db required (postgres|sqlite)")
	}
	if req.Engine == "" {
		req.Engine = "native"
	}
	if _, err := a.store.Get(req.Name); err == nil {
		return Instance{}, fmt.Errorf("instance %q already exists", req.Name)
	}
	switch req.DB {
	case "sqlite":
		return provisionSQLite(a.store, req.Name)
	case "postgres":
		user, pw, db := req.User, req.Password, req.Database
		if user == "" {
			user = "postgres"
		}
		if pw == "" {
			pw = "postgres"
		}
		if db == "" {
			db = req.Name
		}
		if req.Engine == "docker" {
			return provisionPostgresDocker(a.store, req.Name, req.Port, user, pw, db)
		}
		return provisionPostgresNative(a.store, req.Name, req.Port, user, pw, db)
	default:
		return Instance{}, fmt.Errorf("unsupported db %q (v1: postgres|sqlite)", req.DB)
	}
}

func (a *API) handleInstance(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/instances/")
	parts := strings.Split(rest, "/")
	name := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch {
	case r.Method == "GET" && action == "":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		in.Status = liveStatus(in)
		writeJSON(w, 200, in)
	case r.Method == "GET" && action == "connection":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"connection": in.Connection})
	case r.Method == "GET" && action == "logs":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"logs": readLogs(in)})
	case r.Method == "GET" && action == "schema":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		in.Status = liveStatus(in)
		withCounts := r.URL.Query().Get("counts") == "true" || r.URL.Query().Get("counts") == "1"
		schema, err := IntrospectSchema(in, withCounts)
		if err != nil {
			if mce, ok := err.(*MissingCLIError); ok {
				writeJSON(w, 500, map[string]string{"error": mce.Error(), "code": "cli_missing"})
				return
			}
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, schema)
	case r.Method == "GET" && action == "rows":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		in.Status = liveStatus(in)
		table := r.URL.Query().Get("table")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		rows, err := QueryRows(in, table, limit, offset)
		if err != nil {
			if mce, ok := err.(*MissingCLIError); ok {
				writeJSON(w, 500, map[string]string{"error": mce.Error(), "code": "cli_missing"})
				return
			}
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
	case r.Method == "POST" && action == "query":
		in, err := a.store.Get(name)
		if err != nil {
			writeErr(w, 404, err.Error())
			return
		}
		if in.DB == "postgres" && liveStatus(in) != "running" {
			writeErr(w, 409, "instance is not running")
			return
		}
		var req QueryRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
			writeErr(w, 400, "invalid json")
			return
		}
		res, err := RunQuery(in, req.SQL, req.Limit)
		if err != nil {
			if mce, ok := err.(*MissingCLIError); ok {
				writeJSON(w, 500, map[string]string{"error": mce.Error(), "code": "cli_missing"})
				return
			}
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, res)
	case r.Method == "POST" && action == "start":
		if err := a.start(name); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		in, _ := a.store.Get(name)
		writeJSON(w, 200, in)
	case r.Method == "POST" && action == "stop":
		if err := a.stop(name); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		in, _ := a.store.Get(name)
		writeJSON(w, 200, in)
	case r.Method == "POST" && action == "restart":
		_ = a.stop(name)
		if err := a.start(name); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		in, _ := a.store.Get(name)
		writeJSON(w, 200, in)
	case r.Method == "DELETE" && action == "":
		keep := r.URL.Query().Get("keepData") == "true" || r.URL.Query().Get("keep-data") == "true"
		if err := a.remove(name, keep); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"removed": name})
	default:
		writeErr(w, 404, "not found")
	}
}

func (a *API) start(name string) error {
	in, err := a.store.Get(name)
	if err != nil {
		return err
	}
	switch {
	case in.DB == "sqlite":
		in.Status = "running"
		return a.store.Upsert(in)
	case in.DB == "postgres" && in.Engine == "docker":
		if _, err := dockerExec("start", dockerName(name)); err != nil {
			return fmt.Errorf("docker start: %v", err)
		}
		in.Status = "running"
		return a.store.Upsert(in)
	default:
		if err := startPostgresNative(in); err != nil {
			return err
		}
		in.Status = "running"
		return a.store.Upsert(in)
	}
}

func (a *API) stop(name string) error {
	in, err := a.store.Get(name)
	if err != nil {
		return err
	}
	switch {
	case in.DB == "sqlite":
		in.Status = "stopped"
		return a.store.Upsert(in)
	case in.DB == "postgres" && in.Engine == "docker":
		_, _ = dockerExec("stop", dockerName(name))
		in.Status = "stopped"
		return a.store.Upsert(in)
	default:
		_ = stopPostgresNative(in)
		in.Status = "stopped"
		return a.store.Upsert(in)
	}
}

func (a *API) remove(name string, keepData bool) error {
	in, err := a.store.Get(name)
	if err != nil {
		return err
	}
	_ = a.stop(name)
	if in.Engine == "docker" && in.DB == "postgres" {
		_, _ = dockerExec("rm", "-v", "-f", dockerName(name))
	}
	if !keepData {
		_ = os.RemoveAll(in.DataDir)
	}
	return a.store.Remove(name)
}

func liveStatus(in Instance) string {
	if in.DB == "sqlite" {
		if in.Status == "stopped" {
			return "stopped"
		}
		return "running"
	}
	if in.Engine == "docker" {
		out, err := dockerExec("inspect", "-f", "{{.State.Running}}", dockerName(in.Name))
		if err != nil {
			return in.Status
		}
		if strings.Contains(out, "true") {
			return "running"
		}
		return "stopped"
	}
	if in.Port != 0 && portOpen(in.Port) {
		return "running"
	}
	return in.Status
}

func readLogs(in Instance) string {
	if in.Engine == "docker" {
		out, _ := dockerExec("logs", "--tail", "200", dockerName(in.Name))
		return out
	}
	if in.LogFile != "" {
		data, err := os.ReadFile(in.LogFile)
		if err != nil {
			return ""
		}
		if len(data) > 20000 {
			return string(data[len(data)-20000:])
		}
		return string(data)
	}
	// sqlite: no logs
	return ""
}

func (a *API) handleDeps(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeErr(w, 405, "method not allowed")
		return
	}
	writeJSON(w, 200, map[string]any{
		"postgres": PostgresDep(),
		"docker":   DockerDep(),
	})
}

// handleShutdown stops the server itself. Managed databases are left
// running — they are user data and are rediscovered (liveStatus) by the
// next server via state.json.
func (a *API) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeErr(w, 405, "method not allowed")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "shutting down"})
	go func() {
		time.Sleep(150 * time.Millisecond)
		_ = os.Remove(ServerFile())
		os.Exit(0)
	}()
}

func (a *API) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	for i := 0; i < 30; i++ {
		list, _ := a.store.List()
		for j := range list {
			list[j].Status = liveStatus(list[j])
		}
		data, _ := json.Marshal(list)
		fmt.Fprintf(w, "data: %s\n\n", string(data))
		fl.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-wait1s():
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// --- server discovery ---

type ServerInfo struct {
	Port   int    `json:"port"`
	PID    int    `json:"pid"`
	Token  string `json:"token"`
	Socket string `json:"socket,omitempty"`
}

func LoadServerInfo() (ServerInfo, bool) {
	data, err := os.ReadFile(ServerFile())
	if err != nil {
		return ServerInfo{}, false
	}
	var si ServerInfo
	if err := json.Unmarshal(data, &si); err != nil {
		return ServerInfo{}, false
	}
	return si, true
}

func WriteServerInfo(si ServerInfo) error {
	_ = EnsureBase()
	data, _ := json.Marshal(si)
	return os.WriteFile(ServerFile(), data, 0o600)
}

func NewToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func PortStr() string {
	if v := os.Getenv("DBEED_PORT"); v != "" {
		return v
	}
	return "0"
}
