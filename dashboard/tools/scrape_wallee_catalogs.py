import re, json, sys, time, urllib.request, html
def fetch(url):
    req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (catalog-scraper)'})
    for i in range(3):
        try: return urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
        except Exception as e:
            time.sleep(2*(i+1)); err=e
    raise err
def clean(s): return re.sub(r'\s+',' ',html.unescape(s)).strip()
def scrape(kind, lang):
    out={}; page=1
    while True:
        h=fetch(f"https://app-wallee.com/{lang}/doc/api/{kind}/list?page={page}")
        rows=re.findall(r'<tr class=""\s*data-grid-action="view/(\d+)"\s*data-entity-name="([^"]*)">(.*?)</tr>', h, re.S)
        if not rows: break
        for id_, name, body in rows:
            tds=[clean(re.sub('<[^>]+>',' ',t)) for t in re.findall(r'<td[^>]*>(.*?)</td>', body, re.S)]
            desc=re.search(r'class="description">(.*?)</div>', body, re.S)
            out[id_]={'name':clean(name),'description':clean(desc.group(1)) if desc else '', 'cols':tds}
        m=re.search(r'of <strong>([\d,]+)</strong>', h); total=int(m.group(1).replace(',','')) if m else None
        print(kind, lang, 'page', page, 'rows', len(rows), 'acc', len(out), 'total', total, file=sys.stderr)
        if total and len(out)>=total: break
        page+=1; time.sleep(0.3)
    return out
kind, lang = sys.argv[1], sys.argv[2]
json.dump(scrape(kind, lang), open(f"{kind}_{lang}.json","w"), ensure_ascii=False, indent=1)
