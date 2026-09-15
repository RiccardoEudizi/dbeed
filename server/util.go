package server

import "time"

func wait1s() <-chan time.Time { return time.After(1000 * 1_000_000_000) }
