package server

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Instance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	DB         string `json:"db"`     // postgres | sqlite
	Engine     string `json:"engine"` // native | docker
	Status     string `json:"status"` // running | stopped
	Port       int    `json:"port,omitempty"`
	User       string `json:"user,omitempty"`
	Password   string `json:"password,omitempty"`
	Database   string `json:"database,omitempty"`
	DataDir    string `json:"dataDir"`
	PID        int    `json:"pid,omitempty"`
	Container  string `json:"container,omitempty"`
	Connection string `json:"connection"`
	CreatedAt  string `json:"createdAt"`
	LogFile    string `json:"logFile,omitempty"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func NewStore() (*Store, error) {
	if err := EnsureBase(); err != nil {
		return nil, err
	}
	return &Store{path: StateFile()}, nil
}

func (s *Store) load() ([]Instance, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return []Instance{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []Instance{}, nil
	}
	var list []Instance
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *Store) save(list []Instance) error {
	tmp := s.path + ".tmp"
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) List() ([]Instance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) Get(name string) (Instance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.load()
	if err != nil {
		return Instance{}, err
	}
	for _, in := range list {
		if in.Name == name {
			return in, nil
		}
	}
	return Instance{}, fmt.Errorf("instance %q not found", name)
}

func (s *Store) Upsert(in Instance) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.load()
	if err != nil {
		return err
	}
	found := false
	for i, cur := range list {
		if cur.Name == in.Name {
			list[i] = in
			found = true
			break
		}
	}
	if !found {
		list = append(list, in)
	}
	return s.save(list)
}

func (s *Store) Remove(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.load()
	if err != nil {
		return err
	}
	out := list[:0]
	for _, cur := range list {
		if cur.Name != name {
			out = append(out, cur)
		}
	}
	return s.save(out)
}

func ConnectionString(in Instance) string {
	switch in.DB {
	case "sqlite":
		p := filepath.Join(in.DataDir, "db.sqlite")
		return "sqlite://" + p
	case "postgres":
		u := &url.URL{Scheme: "postgres", Host: fmt.Sprintf("127.0.0.1:%d", in.Port)}
		if in.User != "" {
			if in.Password != "" {
				u.User = url.UserPassword(in.User, in.Password)
			} else {
				u.User = url.User(in.User)
			}
		}
		u.Path = "/" + in.Database
		q := u.Query()
		q.Set("sslmode", "disable")
		u.RawQuery = q.Encode()
		return u.String()
	default:
		return ""
	}
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }
