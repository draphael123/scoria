"""Static dev server for SCORIA that refuses to let the browser cache anything.

`python -m http.server` serves ES modules with a Last-Modified and no
Cache-Control, and Chrome will happily reuse a module from memory cache without
revalidating. That produces the worst possible failure mode for a game split
across twenty modules: a FRESH config.js next to a STALE game.js, reading a
tuning key that no longer exists, which shows up as an AI that silently stops
doing anything rather than as an error.

Run:  python tools/devserver.py [port]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console for real errors only; a module-heavy page logs ~25
        # lines per reload otherwise.
        if not str(args[1] if len(args) > 1 else '').startswith('2'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5810
    print(f'SCORIA dev server (no-store) on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
