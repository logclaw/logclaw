#!/usr/bin/env python3
"""
LogClaw Dashboard Server
Serves the dashboard HTML and proxies API calls to local services.
Run: python3 dashboard/server.py
Open: http://localhost:3333
"""
import http.server
import urllib.request
import urllib.error
import json
import os
import sys

PORT = 3333
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))

# Proxy routes: /api/<service>/* → localhost:<port>/*
PROXY_MAP = {
    '/api/opensearch/': 'http://localhost:9200/',
    '/api/vector/': 'http://localhost:18080/',
    '/api/ticketing/': 'http://localhost:18081/',
    '/api/feast/': 'http://localhost:6567/',
    '/api/airflow/': 'http://localhost:28080/',
}

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DASHBOARD_DIR, **kwargs)

    def do_GET(self):
        for prefix, target in PROXY_MAP.items():
            if self.path.startswith(prefix):
                return self._proxy(prefix, target)
        return super().do_GET()

    def do_POST(self):
        for prefix, target in PROXY_MAP.items():
            if self.path.startswith(prefix):
                return self._proxy(prefix, target)
        self.send_error(404)

    def _proxy(self, prefix, target):
        downstream_path = self.path[len(prefix):]
        url = target + downstream_path

        # Read request body if present
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        req = urllib.request.Request(url, data=body, method=self.command)
        req.add_header('Content-Type', self.headers.get('Content-Type', 'application/json'))

        try:
            resp = urllib.request.urlopen(req, timeout=10)
            data = resp.read()
            self.send_response(resp.status)
            self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def log_message(self, format, *args):
        # Suppress noisy request logs, show only errors
        if '404' in str(args) or '500' in str(args) or '502' in str(args):
            super().log_message(format, *args)

if __name__ == '__main__':
    print(f'\n  🔍 LogClaw Dashboard')
    print(f'  ────────────────────')
    print(f'  URL:  http://localhost:{PORT}')
    print(f'  API:  /api/opensearch/*  → localhost:9200')
    print(f'        /api/vector/*      → localhost:18080')
    print(f'        /api/ticketing/*   → localhost:18081')
    print(f'        /api/feast/*       → localhost:6567')
    print(f'        /api/airflow/*     → localhost:28080')
    print(f'  ────────────────────')
    print(f'  Press Ctrl+C to stop\n')

    with http.server.HTTPServer(('', PORT), DashboardHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down...')
