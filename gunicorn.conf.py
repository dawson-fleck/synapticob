"""One process owns the classroom session store; threads serve requests."""
import os

bind = "0.0.0.0:" + os.environ.get("PORT", "10000")
workers = 1
worker_class = "gthread"
threads = 8
timeout = 180
graceful_timeout = 30
keepalive = 5
limit_request_line = 4094
limit_request_fields = 50
limit_request_field_size = 8190
accesslog = "-"
errorlog = "-"
capture_output = True
loglevel = "info"
# Trust proxy scheme headers only on loopback by default; the app itself validates
# the configured public HTTPS origin and never trusts client-supplied forwarding.
forwarded_allow_ips = "127.0.0.1,::1"
