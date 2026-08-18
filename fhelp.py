# -*- coding: utf-8 -*-
import io, os
ROOT = r"C:/Users/danie/OneDrive/Desktop/Claude Cowork/scoria"

def load(path):
    p = os.path.join(ROOT, path)
    raw = io.open(p, encoding='utf-8', newline='').read()
    return p, raw.count('\r\n') > raw.count('\n') / 2, raw.replace('\r\n', '\n')

def save(p, crlf, s):
    io.open(p, 'w', encoding='utf-8', newline='\r\n' if crlf else '\n').write(s)
    print(('CRLF ' if crlf else 'LF   ') + p)

def cut(s, header):
    """Slice a whole method out by brace-matching from its header. Returns
    (before, body, after). Doing this rather than a regex because a pattern
    scoped to 'a function' will happily run past its closing brace and eat the
    next three siblings."""
    i = s.index(header)
    j = s.index('{', i)
    d = 0
    for k in range(j, len(s)):
        if s[k] == '{': d += 1
        elif s[k] == '}':
            d -= 1
            if d == 0:
                end = k + 1
                break
    return s[:i], s[i:end], s[end:]
