"""Single Render service. HTTPS scheme is fixed by the factory, not headers."""
import os

bind = "0.0.0.0:" + os.environ.get("PORT", "10000")
workers = 1
threads = 2
timeout = 120
forwarded_allow_ips = ""
secure_scheme_headers = {}
